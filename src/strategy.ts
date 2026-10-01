import { config } from "./config.js";
import type { EntryGateDiagnostics, Position, TokenSnapshot } from "./types.js";

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function hourOfWeek(ts = Date.now()) {
  const d = new Date(ts);
  return d.getUTCDay() * 24 + d.getUTCHours();
}

export interface MarketBucket {
  buyMon: number;
  sellMon: number;
  events: number;
  returnSumPct?: number;
  returnSamples?: number;
}

export class SeasonalityModel {
  private buckets = new Map<number, MarketBucket>();

  hydrate(input: Record<string, MarketBucket>) {
    this.buckets.clear();
    for (const [k, v] of Object.entries(input)) this.buckets.set(Number(k), v);
  }

  export() {
    return Object.fromEntries([...this.buckets.entries()].map(([k, v]) => [String(k), v]));
  }

  observe(ts: number, buyMon: number, sellMon: number) {
    const key = hourOfWeek(ts);
    const b = this.buckets.get(key) ?? { buyMon: 0, sellMon: 0, events: 0 };
    b.buyMon += Math.max(0, buyMon);
    b.sellMon += Math.max(0, sellMon);
    b.events += 1;
    this.buckets.set(key, b);
  }

  observeReturn(ts: number, returnPct: number) {
    if (!Number.isFinite(returnPct)) return;
    const key = hourOfWeek(ts);
    const b = this.buckets.get(key) ?? { buyMon: 0, sellMon: 0, events: 0 };
    b.returnSumPct = (b.returnSumPct ?? 0) + clamp(returnPct, -50, 50);
    b.returnSamples = (b.returnSamples ?? 0) + 1;
    this.buckets.set(key, b);
  }

  adjustment(ts = Date.now()) {
    const b = this.buckets.get(hourOfWeek(ts));
    if (!b) return 0;

    const denom = b.buyMon + b.sellMon;
    const flowAdjustment = denom && b.events >= 20
      ? clamp(((b.buyMon - b.sellMon) / denom) * 10, -8, 8)
      : 0;

    const samples = b.returnSamples ?? 0;
    const meanReturn = samples >= 12 ? (b.returnSumPct ?? 0) / samples : 0;

    // Slightly favor entries during historically weak hours, while never
    // overriding the token-level dip/liquidity gates.
    const timingAdjustment = clamp(-meanReturn * 0.75, -4, 4);
    return flowAdjustment + timingAdjustment;
  }

  summary(ts = Date.now()) {
    return this.buckets.get(hourOfWeek(ts)) ?? { buyMon: 0, sellMon: 0, events: 0 };
  }
}

export function curveProgressPct(token: TokenSnapshot) {
  if (token.virtualTokenStart && token.virtualTokenReserve && token.minTokenReserve) {
    const start = BigInt(token.virtualTokenStart);
    const current = BigInt(token.virtualTokenReserve);
    const min = BigInt(token.minTokenReserve);
    const denominator = start - min;
    if (denominator > 0n) {
      const numerator = start > current ? start - current : 0n;
      return clamp(Number((numerator * 10000n) / denominator) / 100, 0, 100);
    }
  }
  return clamp(token.progressPct, 0, 100);
}

function ageMinutes(token: TokenSnapshot) {
  return Math.max(0, (Date.now() - token.createdAt) / 60000);
}

function historyMetrics(token: TokenSnapshot) {
  const history = (token.priceHistory ?? [])
    .filter((x) => Number.isFinite(x.priceMon) && x.priceMon > 0)
    .sort((x, y) => x.ts - y.ts);

  if (!(token.priceMon > 0)) {
    return {
      peak4h: token.priceMon,
      dipPct: 0,
      drawdownFromRecentPeakPct: 0,
      drawdownFromAthPct: 0,
      trend1hPct: 0,
      trend4hPct: 0,
      rebound1hPct: 0,
      dayOpenPriceMon: 0,
      dayHighPriceMon: 0,
      dayLowPriceMon: 0,
      dayAvgPriceMon: 0,
      distanceFromDayLowPct: 0,
      distanceFromDayAvgPct: 0,
      distanceFromDayHighPct: 0
    };
  }

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const fourHoursAgo = now - 4 * 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recent = history.filter((x) => x.ts >= oneHourAgo);
  const fourHour = history.filter((x) => x.ts >= fourHoursAgo);
  const day = history.filter((x) => x.ts >= dayAgo);
  const daySeries = [...day, { ts: now, priceMon: token.priceMon }].sort((a, b) => a.ts - b.ts);

  const observedPeak4h = Math.max(token.priceMon, ...fourHour.map((x) => x.priceMon));
  const observedDipPct = observedPeak4h > 0
    ? Math.max(0, (1 - token.priceMon / observedPeak4h) * 100)
    : 0;

  const athPriceMon = token.athPriceMon && token.athPriceMon > 0
    ? token.athPriceMon
    : observedPeak4h;
  const drawdownFromAthPct = athPriceMon > 0
    ? Math.max(0, (1 - token.priceMon / athPriceMon) * 100)
    : 0;

  const oneHourBase = history.find((x) => x.ts <= oneHourAgo);
  const fourHourBase = history.find((x) => x.ts <= fourHoursAgo);
  const marketChangePct = Number.isFinite(token.changePct) ? token.changePct! : 0;

  const trend1hPct = oneHourBase && oneHourBase.priceMon > 0
    ? (token.priceMon / oneHourBase.priceMon - 1) * 100
    : marketChangePct;
  const trend4hPct = fourHourBase && fourHourBase.priceMon > 0
    ? (token.priceMon / fourHourBase.priceMon - 1) * 100
    : marketChangePct;

  const oneHourLow = recent.length
    ? Math.min(token.priceMon, ...recent.map((x) => x.priceMon))
    : token.priceMon;
  const rebound1hPct = oneHourLow > 0
    ? (token.priceMon / oneHourLow - 1) * 100
    : 0;

  const dayOpenPriceMon = daySeries[0]?.priceMon ?? token.priceMon;
  const dayHighPriceMon = Math.max(token.priceMon, ...daySeries.map((x) => x.priceMon));
  const dayLowPriceMon = Math.min(token.priceMon, ...daySeries.map((x) => x.priceMon));
  const dayAvgPriceMon =
    daySeries.reduce((sum, x) => sum + x.priceMon, 0) / Math.max(1, daySeries.length);
  const distanceFromDayLowPct = dayLowPriceMon > 0
    ? (token.priceMon / dayLowPriceMon - 1) * 100
    : 0;
  const distanceFromDayAvgPct = dayAvgPriceMon > 0
    ? (token.priceMon / dayAvgPriceMon - 1) * 100
    : 0;
  const distanceFromDayHighPct = dayHighPriceMon > 0
    ? (token.priceMon / dayHighPriceMon - 1) * 100
    : 0;

  return {
    peak4h: observedPeak4h,
    dipPct: observedDipPct,
    drawdownFromRecentPeakPct: observedDipPct,
    drawdownFromAthPct,
    trend1hPct,
    trend4hPct,
    rebound1hPct,
    dayOpenPriceMon,
    dayHighPriceMon,
    dayLowPriceMon,
    dayAvgPriceMon,
    distanceFromDayLowPct,
    distanceFromDayAvgPct,
    distanceFromDayHighPct
  };
}

export function isLowCapMomentumCandidate(
  token: TokenSnapshot,
  rules: {
    enabled: boolean;
    minMarketCapUsd: number;
    maxMarketCapUsd: number;
    minLiquidityUsd: number;
    minHolders: number;
    minVolumeUsd: number;
    minAgeMinutes: number;
    minBuySellRatio5m: number;
    minVolume5mUsd: number;
    minVolumeAcceleration5m: number;
    minTrend1hPct: number;
    minLocalScore: number;
  }
) {
  if (!rules.enabled) return false;
  const ageMinutes = Math.max(0, (Date.now() - token.createdAt) / 60000);
  const marketCap = token.marketCapUsd ?? 0;
  const liquidity = token.liquidityUsd ?? 0;
  const holders = token.holders ?? 0;
  const volumeMon = token.volumeMon ?? 0;
  const volumeUsd = volumeMon * (token.monUsdPrice ?? 0);
  const ratio = token.buySellRatio5m ?? 0;
  const volume5mMon = token.volume5mMon ?? 0;
  const volume5mUsd = volume5mMon * (token.monUsdPrice ?? 0);
  const acceleration = token.volumeAcceleration5m ?? 0;
  const trend1h = token.trendPct1h ?? token.changePct ?? 0;
  return marketCap >= rules.minMarketCapUsd && marketCap <= rules.maxMarketCapUsd &&
    liquidity >= rules.minLiquidityUsd && holders >= rules.minHolders &&
    volumeUsd >= rules.minVolumeUsd && ageMinutes >= rules.minAgeMinutes &&
    ratio >= rules.minBuySellRatio5m && volume5mUsd >= rules.minVolume5mUsd &&
    acceleration >= rules.minVolumeAcceleration5m && trend1h >= rules.minTrend1hPct &&
    token.localScore >= rules.minLocalScore;
}
export function selectEntryStrategy(token: TokenSnapshot, minDailySamples = 24, minVolume5mUsd = 1000) {
  const dip = token.dipPct ?? 0;
  const trend1h = token.trendPct1h ?? 0;
  const trend4h = token.trendPct4h ?? 0;
  const dayAvg = token.dayAvgPriceMon ?? 0;
  const dayLow = token.dayLowPriceMon ?? 0;
  const dayLowDistance = token.distanceFromDayLowPct ?? 0;
  const dayAvgDistance = token.distanceFromDayAvgPct ?? 0;
  const buySell = token.buySellRatio5m ?? 0;
  const volume5mMon = token.volume5mMon ?? 0;
  const volume5mUsd = volume5mMon * (token.monUsdPrice ?? 0);
  const acceleration = token.volumeAcceleration5m ?? 0;

  const dailyMeanReversion =
    token.daySamples !== undefined &&
    token.daySamples >= minDailySamples &&
    dayAvg > 0 &&
    dayLow > 0 &&
    dayAvgDistance <= -8 &&
    dayLowDistance <= 6 &&
    dayLowDistance >= 0 &&
    trend4h >= -25;

  const dipReversion =
    dip >= 3 &&
    dip <= 50 &&
    trend1h <= 20 &&
    trend4h >= -25;

  const momentum =
    trend1h > 0 &&
    trend1h <= 20 &&
    trend4h >= -25 &&
    (buySell >= 0.95 || acceleration >= 1.10 || volume5mUsd >= minVolume5mUsd);

  const flow =
    buySell >= 1.25 &&
    acceleration >= 1.05 &&
    volume5mUsd >= minVolume5mUsd &&
    trend4h >= -25;

  if (dailyMeanReversion) return "DAILY_MEAN_REVERSION" as const;
  if (flow) return "FLOW" as const;
  if (momentum) return "MOMENTUM" as const;
  if (dipReversion) return "DIP_REVERSION" as const;
  return "HYBRID" as const;
}

function flowMetrics(token: TokenSnapshot) {
  const now = Date.now();
  const flowApiFresh =
    token.lastFlowApiAt !== undefined &&
    now - token.lastFlowApiAt < config.flowApiRefreshMs * 2;
  if (flowApiFresh) {
    return {
      buySellRatio5m: token.buySellRatio5m ?? 0,
      volume5mMon: token.volume5mMon ?? 0,
      volumePrev5mMon: token.volumePrev5mMon ?? 0,
      volumeAcceleration5m: token.volumeAcceleration5m ?? 0
    };
  }

  const history = (token.flowHistory ?? [])
    .filter((x) => x.ts > now - 10 * 60 * 1000)
    .sort((x, y) => x.ts - y.ts);

  const recent = history.filter((x) => x.ts > now - 5 * 60 * 1000);
  const previous = history.filter((x) => x.ts <= now - 5 * 60 * 1000);

  const sum = (items: typeof history) =>
    items.reduce(
      (acc, x) => ({
        buy: acc.buy + Math.max(0, x.buyMon),
        sell: acc.sell + Math.max(0, x.sellMon)
      }),
      { buy: 0, sell: 0 }
    );

  const recentSum = sum(recent);
  const previousSum = sum(previous);
  const volume5mMon = recentSum.buy + recentSum.sell;
  const volumePrev5mMon = previousSum.buy + previousSum.sell;
  const buySellRatio5m = volume5mMon > 0
    ? recentSum.buy / Math.max(0.01, recentSum.sell)
    : 0;
  const volumeAcceleration5m = volumePrev5mMon > 0
    ? volume5mMon / volumePrev5mMon
    : volume5mMon > 0 ? 2 : 0;

  return {
    buySellRatio5m,
    volume5mMon,
    volumePrev5mMon,
    volumeAcceleration5m
  };
}

export function updateMarketMetrics(token: TokenSnapshot) {
  const metrics = historyMetrics(token);
  const flow = flowMetrics(token);
  token.dipPct = metrics.dipPct;
  token.drawdownFromRecentPeakPct = metrics.drawdownFromRecentPeakPct;
  token.drawdownFromAthPct = metrics.drawdownFromAthPct;
  token.trendPct1h = metrics.trend1hPct;
  token.trendPct4h = metrics.trend4hPct;
  token.reboundPct1h = metrics.rebound1hPct;
  token.dayOpenPriceMon = metrics.dayOpenPriceMon;
  token.dayHighPriceMon = metrics.dayHighPriceMon;
  token.dayLowPriceMon = metrics.dayLowPriceMon;
  token.dayAvgPriceMon = metrics.dayAvgPriceMon;
  token.daySamples = (token.priceHistory ?? []).filter((x) => x.ts >= Date.now() - 24 * 60 * 60 * 1000).length + 1;
  token.distanceFromDayLowPct = metrics.distanceFromDayLowPct;
  token.distanceFromDayAvgPct = metrics.distanceFromDayAvgPct;
  token.distanceFromDayHighPct = metrics.distanceFromDayHighPct;
  const flowApiFresh =
    token.lastFlowApiAt !== undefined &&
    Date.now() - token.lastFlowApiAt < config.flowApiRefreshMs * 2;
  if (!flowApiFresh) {
    token.buySellRatio5m = flow.buySellRatio5m;
    token.volume5mMon = flow.volume5mMon;
    token.volumePrev5mMon = flow.volumePrev5mMon;
    token.volumeAcceleration5m = flow.volumeAcceleration5m;
  }
  token.peakPriceMon = Math.max(token.peakPriceMon, metrics.peak4h || 0);
  return { ...metrics, ...flow };
}

export function scoreToken(token: TokenSnapshot, seasonality: SeasonalityModel) {
  const age = ageMinutes(token);
  const liquidity = token.liquidityMon ?? 0;
  const holders = token.holders ?? 0;
  const volume = token.volumeMon ?? 0;
  const change = token.changePct ?? 0;
  const metrics = historyMetrics(token);

  const liquidityScore = clamp(Math.log10(Math.max(1, liquidity)) * 28, 0, 30);
  const holderScore = clamp(Math.log10(Math.max(1, holders)) * 18, 0, 20);
  const volumeScore = clamp(Math.log10(Math.max(1, volume)) * 14, 0, 20);

  // Favor established tokens with a healthy longer-term trend, not fresh launches.
  const momentumScore = clamp(10 + change * 0.35 + metrics.trend4hPct * 0.45, 0, 15);

  // Reward a real pullback, especially inside the aggressive 8-35% dip band.
  const dip = metrics.dipPct;
  const dipScore =
    dip < 4 ? 0 :
    dip < 8 ? 5 :
    dip <= 18 ? 15 :
    dip <= 28 ? 20 :
    dip <= 35 ? 14 :
    4;

  // A small rebound is preferable to catching a straight falling knife.
  const reboundScore = clamp(metrics.rebound1hPct * 2.5, 0, 10);
  const dailyMeanScore =
    metrics.dayAvgPriceMon > 0 && metrics.distanceFromDayAvgPct < 0
      ? clamp(-metrics.distanceFromDayAvgPct * 0.75, 0, 9)
      : 0;
  const dayLowProximityScore =
    metrics.distanceFromDayLowPct >= 0 && metrics.distanceFromDayLowPct <= 6
      ? clamp(6 - metrics.distanceFromDayLowPct, 0, 6)
      : 0;
  const flow = flowMetrics(token);
  const flowScore = flow.volume5mMon <= 0
    ? 0
    : clamp((flow.buySellRatio5m - 1) * 4 + (flow.volumeAcceleration5m - 1) * 3, -5, 5);
  const seasonalityAdjustment = seasonality.adjustment();

  return Math.round(clamp(
    liquidityScore +
    holderScore +
    volumeScore +
    momentumScore +
    dipScore +
    reboundScore +
    dailyMeanScore +
    dayLowProximityScore +
    flowScore +
    seasonalityAdjustment,
    0,
    100
  ));
}

export interface EntryGateRules {
  minEstablishedAgeMinutes: number;
  minLiquidityUsd: number;
  minMarketCapUsd: number;
  minHolders: number;
  minVolumeUsd: number;
  dipMinPct: number;
  dipMaxPct: number;
  recoveryMinPct: number;
  trendMax1hPct: number;
  minTrend4hPct: number;
  minLocalScore: number;
  minAiConfidence?: number;
}

function money(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1000000) return "$" + (value / 1000000).toFixed(2) + "m";
  if (value >= 1000) return "$" + (value / 1000).toFixed(1) + "k";
  return "$" + value.toFixed(0);
}

export function entryGateDiagnostics(
  token: TokenSnapshot,
  rules: EntryGateRules,
  aiConfidence?: number
): EntryGateDiagnostics {
  const age = ageMinutes(token);
  const metrics = historyMetrics(token);
  const blockers: string[] = [];

  if (!(token.createdAt > 0)) blockers.push("missing creation time");
  if (!token.graduated) blockers.push("not graduated");
  if (token.locked) blockers.push("token is locked");

  const liquidity = token.liquidityUsd ?? 0;
  if (liquidity < rules.minLiquidityUsd) {
    blockers.push(`liquidity ${money(liquidity)} < ${money(rules.minLiquidityUsd)}`);
  }

  const marketCapUsd = token.marketCapUsd ?? 0;
  if (marketCapUsd < rules.minMarketCapUsd) {
    blockers.push(`market cap ${money(marketCapUsd)} < ${money(rules.minMarketCapUsd)}`);
  }

  const holders = token.holders ?? 0;
  if (holders < rules.minHolders) {
    blockers.push(`holders ${holders} < ${rules.minHolders}`);
  }

  const volumeMon = token.volumeMon ?? 0;
  const volumeUsd = volumeMon * (token.monUsdPrice ?? 0);
  if (volumeUsd < rules.minVolumeUsd) {
    blockers.push(`volume ${money(volumeUsd)} < ${money(rules.minVolumeUsd)}`);
  }

  if (age < rules.minEstablishedAgeMinutes) {
    blockers.push(`age ${age.toFixed(0)}m < ${rules.minEstablishedAgeMinutes}m`);
  }

  const dipInEntryBand =
    metrics.dipPct >= rules.dipMinPct &&
    metrics.dipPct <= rules.dipMaxPct;
  const momentumEntry =
    metrics.dipPct <= rules.dipMaxPct &&
    metrics.trend1hPct > 0 &&
    metrics.trend1hPct <= rules.trendMax1hPct &&
    metrics.trend4hPct >= rules.minTrend4hPct;

  const dailyMeanEntry =
    metrics.dayAvgPriceMon > 0 &&
    metrics.dayLowPriceMon > 0 &&
    metrics.distanceFromDayAvgPct <= -8 &&
    metrics.distanceFromDayLowPct <= 6 &&
    metrics.distanceFromDayLowPct >= 0 &&
    metrics.trend4hPct >= rules.minTrend4hPct;

  const flowEntry =
    metrics.trend4hPct >= rules.minTrend4hPct &&
    token.buySellRatio5m !== undefined &&
    token.buySellRatio5m >= 1.15 &&
    (token.volume5mMon ?? 0) * (token.monUsdPrice ?? 0) >= rules.minVolumeUsd;

  if (!dipInEntryBand && !momentumEntry && !dailyMeanEntry && !flowEntry) {
    if (metrics.dipPct < rules.dipMinPct) {
      blockers.push(`dip ${metrics.dipPct.toFixed(1)}% < ${rules.dipMinPct}% and momentum is not strong enough`);
    } else if (metrics.dipPct > rules.dipMaxPct) {
      blockers.push(`dip ${metrics.dipPct.toFixed(1)}% > ${rules.dipMaxPct}%`);
    }
  }

  if (metrics.rebound1hPct < rules.recoveryMinPct) {
    blockers.push(`rebound ${metrics.rebound1hPct.toFixed(1)}% < ${rules.recoveryMinPct}%`);
  }

  if (metrics.trend1hPct > rules.trendMax1hPct) {
    blockers.push(`1h trend +${metrics.trend1hPct.toFixed(1)}% > +${rules.trendMax1hPct}%`);
  }

  if (metrics.trend4hPct < rules.minTrend4hPct) {
    blockers.push(`4h trend ${metrics.trend4hPct.toFixed(1)}% < ${rules.minTrend4hPct}%`);
  }

  if (token.localScore < rules.minLocalScore) {
    blockers.push(`score ${token.localScore} < ${rules.minLocalScore}`);
  }

  if (aiConfidence !== undefined && rules.minAiConfidence !== undefined && aiConfidence < rules.minAiConfidence) {
    blockers.push(`AI confidence ${(aiConfidence * 100).toFixed(0)}% < ${(rules.minAiConfidence * 100).toFixed(0)}%`);
  }

  return {
    checkedAt: Date.now(),
    readyForAi: blockers.length === 0 || (
      blockers.length === 1 &&
      aiConfidence !== undefined &&
      blockers[0].startsWith("AI confidence ")
    ),
    primary: blockers[0] ?? "ready for AI evaluation",
    blockers,
    metrics: {
      ageMinutes: age,
      liquidityUsd: liquidity,
      marketCapUsd,
      holders,
      volumeMon,
      volumeUsd,
      dipPct: metrics.dipPct,
      drawdownFromRecentPeakPct: metrics.drawdownFromRecentPeakPct,
      drawdownFromAthPct: metrics.drawdownFromAthPct,
      rebound1hPct: metrics.rebound1hPct,
      trend1hPct: metrics.trend1hPct,
      trend4hPct: metrics.trend4hPct,
      dayLowPriceMon: metrics.dayLowPriceMon,
      dayAvgPriceMon: metrics.dayAvgPriceMon,
      distanceFromDayLowPct: metrics.distanceFromDayLowPct,
      distanceFromDayAvgPct: metrics.distanceFromDayAvgPct,
      localScore: token.localScore
    },
    aiConfidence
  };
}

export function shouldWatch(
  token: TokenSnapshot,
  minLiquidityUsd: number,
  minMarketCapUsd: number,
  minHolders: number,
  minVolumeUsd: number
) {
  return (
    token.createdAt > 0 &&
    token.graduated &&
    !token.locked &&
    (token.liquidityUsd ?? 0) >= minLiquidityUsd &&
    (token.marketCapUsd ?? 0) >= minMarketCapUsd &&
    (token.holders ?? 0) >= minHolders &&
    (token.volumeMon ?? 0) * (token.monUsdPrice ?? 0) >= minVolumeUsd
  );
}

export function shouldOpen(
  token: TokenSnapshot,
  confidence: number,
  minScore: number,
  minConfidence: number,
  minEstablishedAgeMinutes: number,
  minLiquidityUsd: number,
  minMarketCapUsd: number,
  minHolders: number,
  minVolumeUsd: number,
  dipMinPct: number,
  dipMaxPct: number,
  recoveryMinPct: number,
  trendMax1hPct: number,
  minTrend4hPct: number
) {
  const diagnostics = entryGateDiagnostics(
    token,
    {
      minEstablishedAgeMinutes,
      minLiquidityUsd,
      minMarketCapUsd,
      minHolders,
      minVolumeUsd,
      dipMinPct,
      dipMaxPct,
      recoveryMinPct,
      trendMax1hPct,
      minTrend4hPct,
      minLocalScore: minScore,
      minAiConfidence: minConfidence
    },
    confidence
  );
  return diagnostics.blockers.length === 0;
}

export interface PositionExitRules {
  hardStopPct: number;
  takeProfitPct: number;
  trailingPct: number;
  maxHoldMinutes: number;
  staleLossExitMinutes: number;
  staleLossExitPct: number;
  deadMoneyExitMinutes: number;
  deadMoneyMaxPnlPct: number;
  dustPositionMon: number;
  dailyMeanExitPct: number;
  dailyMinSamples: number;
  minLiquidityUsd: number;
  liquidityExitRatio: number;
  earlyExitLossPct: number;
  earlyExitTrend1hPct: number;
  momentumExitProfitPct: number;
  momentumExitTrend1hPct: number;
  momentumExitReboundPct: number;
  sellPressureExitRatio: number;
  sellPressureMinVolumeUsd: number;
  profitTake1Pct: number;
  profitTake1SellPct: number;
  profitTake2Pct: number;
  profitTake2SellPct: number;
  profitTake3Pct: number;
  profitTake3SellPct: number;
  profitProtectionStartPct: number;
  profitProtectionFloorPct: number;
  profitProtectionRatio: number;
  lowCapMaxMarketCapUsd?: number;
  lowCapLiquidityExitRatio?: number;
  lowCapSellPressureRatio?: number;
  lowCapSellPressureMinVolumeUsd?: number;
  lowCapTrendExitPct?: number;
  lowCapLossExitPct?: number;
  lowCapPeakDrawdownExitPct?: number;
}

export interface PositionExitSignal {
  kind: "FULL" | "PARTIAL";
  sellPct: number;
  reason: string;
}

export function positionExitSignal(
  position: Position,
  token: TokenSnapshot | undefined,
  rules: PositionExitRules
): PositionExitSignal | null {
  const pnlPct = position.pnlPct;
  const peakPnlPct = Math.max(position.peakPnlPct ?? pnlPct, pnlPct);
  const heldMinutes = (Date.now() - position.openedAt) / 60000;
  const trend1h = token?.trendPct1h ?? 0;
  const rebound1h = token?.reboundPct1h ?? 0;
  const dipPct = token?.dipPct ?? 0;
  const flowRatio = token?.buySellRatio5m ?? 0;
  const flowVolumeMon = token?.volume5mMon ?? 0;
  const flowVolumeUsd = flowVolumeMon * (token?.monUsdPrice ?? 0);
  const dayAvg = token?.dayAvgPriceMon ?? 0;
  const dayLowDistance = token?.distanceFromDayLowPct ?? 0;
  const dayAvgDistance = token?.distanceFromDayAvgPct ?? 0;
  const daySamples = token?.daySamples ?? 0;
  const marketCapUsd = token?.marketCapUsd ?? 0;
  const lowCapMode = marketCapUsd > 0 && marketCapUsd <= (rules.lowCapMaxMarketCapUsd ?? 0);
  const lowCapLiquidityExitRatio = rules.lowCapLiquidityExitRatio ?? 0.80;
  const lowCapSellPressureRatio = rules.lowCapSellPressureRatio ?? 0.75;
  const lowCapSellPressureMinVolumeUsd = rules.lowCapSellPressureMinVolumeUsd ?? 1000;
  const lowCapTrendExitPct = rules.lowCapTrendExitPct ?? -5;
  const lowCapLossExitPct = rules.lowCapLossExitPct ?? -4;
  const lowCapPeakDrawdownExitPct = rules.lowCapPeakDrawdownExitPct ?? 12;

  // Protective conditions always win over profit-seeking AI guidance.
  if (lowCapMode && token) {
    const liquidity = token.liquidityUsd ?? 0;
    const liquidityBroken = liquidity > 0 && (
      liquidity < rules.minLiquidityUsd ||
      ((position.entryLiquidityUsd ?? 0) > 0 && liquidity < (position.entryLiquidityUsd ?? 0) * lowCapLiquidityExitRatio)
    );
    if (liquidityBroken) return { kind: "FULL", sellPct: 100, reason: "LOW_CAP_LIQUIDITY_BREAK" };
    if (flowVolumeUsd >= Math.min(lowCapSellPressureMinVolumeUsd, 750) && flowRatio > 0 && flowRatio <= lowCapSellPressureRatio && trend1h < 0) {
      return { kind: "FULL", sellPct: 100, reason: "LOW_CAP_SELL_PRESSURE" };
    }
    if (pnlPct <= Math.max(lowCapLossExitPct, -3) && trend1h < 0) {
      return { kind: "FULL", sellPct: 100, reason: "LOW_CAP_MOMENTUM_BREAK" };
    }
    // A low-cap winner can reverse hard before the generic trailing stop fires.
    // Use the configured 1h trend break as an additional early exit while
    // allowing a small positive buffer for normal noise.
    if (trend1h <= lowCapTrendExitPct && pnlPct <= 3) {
      return { kind: "FULL", sellPct: 100, reason: "LOW_CAP_TREND_BREAK" };
    }
    if (position.peakMon > position.entryMon && position.currentMon <= position.peakMon * (1 - lowCapPeakDrawdownExitPct / 100)) {
      return { kind: "FULL", sellPct: 100, reason: "LOW_CAP_PEAK_REVERSAL" };
    }
  }
  if (pnlPct <= -rules.hardStopPct) {
    return { kind: "FULL", sellPct: 100, reason: "HARD_STOP" };
  }

  if (token) {
    const liquidity = token.liquidityUsd ?? 0;
    const liquidityCollapsed = liquidity > 0 && (
      liquidity < rules.minLiquidityUsd ||
      (
        (position.entryLiquidityUsd ?? 0) > 0 &&
        liquidity < (position.entryLiquidityUsd ?? 0) * rules.liquidityExitRatio
      )
    );
    if (liquidityCollapsed) {
      return { kind: "FULL", sellPct: 100, reason: "LIQUIDITY_BREAK" };
    }

    if (
      pnlPct <= rules.earlyExitLossPct &&
      trend1h <= rules.earlyExitTrend1hPct &&
      dipPct >= 20
    ) {
      return { kind: "FULL", sellPct: 100, reason: "EARLY_MOMENTUM_STOP" };
    }

    if (
      flowVolumeUsd >= rules.sellPressureMinVolumeUsd &&
      flowRatio > 0 &&
      flowRatio <= rules.sellPressureExitRatio &&
      trend1h < 0
    ) {
      return { kind: "FULL", sellPct: 100, reason: "ACCELERATING_SELL_PRESSURE" };
    }

    if (
      pnlPct >= rules.momentumExitProfitPct &&
      trend1h <= rules.momentumExitTrend1hPct &&
      rebound1h <= rules.momentumExitReboundPct
    ) {
      return { kind: "FULL", sellPct: 100, reason: "MOMENTUM_FAILURE" };
    }
  }

  // Daily mean-reversion is an exit target only when the position was
  // opened as that strategy and enough rolling-24h samples exist. Other
  // strategies keep their own momentum/profit exits.
  if (
    position.strategy === "DAILY_MEAN_REVERSION" &&
    token &&
    daySamples >= rules.dailyMinSamples &&
    dayAvg > 0 &&
    pnlPct >= rules.dailyMeanExitPct &&
    dayAvgDistance >= -0.5 &&
    dayLowDistance > 0
  ) {
    return { kind: "FULL", sellPct: 100, reason: "DAILY_MEAN_REVERSION_EXIT" };
  }

  // Kill dead-money positions instead of letting a small remainder decay for
  // hours. This is deliberately separate from the hard stop.
  if (
    heldMinutes >= rules.staleLossExitMinutes &&
    pnlPct <= rules.staleLossExitPct &&
    trend1h <= 0
  ) {
    return { kind: "FULL", sellPct: 100, reason: "STALE_LOSS_EXIT" };
  }

  if (
    heldMinutes >= rules.deadMoneyExitMinutes &&
    pnlPct <= rules.deadMoneyMaxPnlPct &&
    pnlPct >= rules.staleLossExitPct &&
    trend1h <= 2
  ) {
    return { kind: "FULL", sellPct: 100, reason: "DEAD_MONEY_EXIT" };
  }

  if (
    position.currentMon > 0 &&
    position.currentMon <= rules.dustPositionMon
  ) {
    return { kind: "FULL", sellPct: 100, reason: "DUST_SWEEP" };
  }

  // Once the trade has made real money, protect part of that profit instead
  // of letting a winner turn into a loser.
  if (peakPnlPct >= rules.profitProtectionStartPct) {
    const lockedProfit = Math.max(
      rules.profitProtectionFloorPct,
      peakPnlPct * rules.profitProtectionRatio
    );
    if (pnlPct <= lockedProfit && pnlPct < peakPnlPct) {
      return { kind: "FULL", sellPct: 100, reason: "PROFIT_PROTECTION" };
    }
  }

  if (!position.profitTake1Done && pnlPct >= rules.profitTake1Pct) {
    return { kind: "PARTIAL", sellPct: rules.profitTake1SellPct, reason: "PROFIT_TAKE_1" };
  }

  if (!position.profitTake2Done && pnlPct >= rules.profitTake2Pct) {
    return { kind: "PARTIAL", sellPct: rules.profitTake2SellPct, reason: "PROFIT_TAKE_2" };
  }

  if (!position.profitTake3Done && pnlPct >= rules.profitTake3Pct) {
    return { kind: "PARTIAL", sellPct: rules.profitTake3SellPct, reason: "PROFIT_TAKE_3" };
  }

  if (pnlPct >= rules.takeProfitPct) {
    return { kind: "FULL", sellPct: 100, reason: "TAKE_PROFIT" };
  }

  if (position.peakMon > position.entryMon && position.currentMon <= position.peakMon * (1 - rules.trailingPct / 100)) {
    return { kind: "FULL", sellPct: 100, reason: "TRAILING_STOP" };
  }

  if (heldMinutes >= rules.maxHoldMinutes) {
    return { kind: "FULL", sellPct: 100, reason: "MAX_HOLD" };
  }

  return null;
}

export function shouldClose(
  position: Position,
  hardStopPct: number,
  takeProfitPct: number,
  trailingPct: number,
  maxHoldMinutes: number
) {
  const held = (Date.now() - position.openedAt) / 60000;
  if (position.pnlPct <= -hardStopPct) return "HARD_STOP";
  if (position.pnlPct >= takeProfitPct) return "TAKE_PROFIT";
  const peakDraw = position.peakMon > position.entryMon
    ? (position.currentMon / position.peakMon - 1) * 100
    : 0;
  if (position.peakMon > position.entryMon && peakDraw <= -trailingPct) return "TRAILING_STOP";
  if (held >= maxHoldMinutes) return "MAX_HOLD";
  return null;
}
