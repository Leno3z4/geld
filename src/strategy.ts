import type { Position, TokenSnapshot } from "./types.js";

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
    .sort((a, b) => a.ts - b.ts);

  if (!history.length || !(token.priceMon > 0)) {
    return { peak4h: token.priceMon, dipPct: 0, trend1hPct: 0, trend4hPct: 0, rebound1hPct: 0 };
  }

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const fourHoursAgo = now - 4 * 60 * 60 * 1000;
  const recent = history.filter((x) => x.ts >= oneHourAgo);
  const fourHour = history.filter((x) => x.ts >= fourHoursAgo);

  const peak4h = Math.max(token.priceMon, ...fourHour.map((x) => x.priceMon));
  const dipPct = peak4h > 0 ? Math.max(0, (1 - token.priceMon / peak4h) * 100) : 0;

  const nearest = (samples: typeof history, target: number) =>
    samples.reduce((best, x) =>
      Math.abs(x.ts - target) < Math.abs(best.ts - target) ? x : best
    );

  const oneHourBase = history.find((x) => x.ts <= oneHourAgo) ?? (recent[0] ? nearest(recent, oneHourAgo) : history[0]);
  const fourHourBase = history.find((x) => x.ts <= fourHoursAgo) ?? (fourHour[0] ? nearest(fourHour, fourHoursAgo) : history[0]);

  const trend1hPct = oneHourBase?.priceMon > 0
    ? (token.priceMon / oneHourBase.priceMon - 1) * 100
    : 0;
  const trend4hPct = fourHourBase?.priceMon > 0
    ? (token.priceMon / fourHourBase.priceMon - 1) * 100
    : 0;

  const oneHourLow = Math.min(token.priceMon, ...recent.map((x) => x.priceMon));
  const rebound1hPct = oneHourLow > 0
    ? (token.priceMon / oneHourLow - 1) * 100
    : 0;

  return { peak4h, dipPct, trend1hPct, trend4hPct, rebound1hPct };
}

function flowMetrics(token: TokenSnapshot) {
  const now = Date.now();
  const history = (token.flowHistory ?? [])
    .filter((x) => x.ts > now - 10 * 60 * 1000)
    .sort((a, b) => a.ts - b.ts);

  const recent = history.filter((x) => x.ts > now - 5 * 60 * 1000);
  const previous = history.filter((x) => x.ts <= now - 5 * 60 * 1000);

  const sum = (items: typeof history) => items.reduce(
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
  token.trendPct1h = metrics.trend1hPct;
  token.trendPct4h = metrics.trend4hPct;
  token.reboundPct1h = metrics.rebound1hPct;
  token.buySellRatio5m = flow.buySellRatio5m;
  token.volume5mMon = flow.volume5mMon;
  token.volumePrev5mMon = flow.volumePrev5mMon;
  token.volumeAcceleration5m = flow.volumeAcceleration5m;
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
    flowScore +
    seasonalityAdjustment,
    0,
    100
  ));
}

export function shouldWatch(token: TokenSnapshot, minLiquidityUsd: number, minHolders: number, minVolumeMon: number) {
  return (
    token.createdAt > 0 &&
    token.graduated &&
    !token.locked &&
    (token.liquidityUsd ?? 0) >= minLiquidityUsd &&
    (token.holders ?? 0) >= minHolders &&
    (token.volumeMon ?? 0) >= minVolumeMon
  );
}

export function shouldOpen(
  token: TokenSnapshot,
  confidence: number,
  minScore: number,
  minConfidence: number,
  minEstablishedAgeMinutes: number,
  minLiquidityUsd: number,
  minHolders: number,
  minVolumeMon: number,
  dipMinPct: number,
  dipMaxPct: number,
  recoveryMinPct: number,
  trendMax1hPct: number,
  minTrend4hPct: number
) {
  const age = ageMinutes(token);
  const metrics = historyMetrics(token);

  return (
    token.createdAt > 0 &&
    token.graduated &&
    !token.locked &&
    age >= minEstablishedAgeMinutes &&
    (token.liquidityUsd ?? 0) >= minLiquidityUsd &&
    (token.holders ?? 0) >= minHolders &&
    (token.volumeMon ?? 0) >= minVolumeMon &&
    metrics.dipPct >= dipMinPct &&
    metrics.dipPct <= dipMaxPct &&
    metrics.rebound1hPct >= recoveryMinPct &&
    metrics.trend1hPct <= trendMax1hPct &&
    metrics.trend4hPct >= minTrend4hPct &&
    token.localScore >= minScore &&
    confidence >= minConfidence
  );
}

export interface PositionExitRules {
  hardStopPct: number;
  takeProfitPct: number;
  trailingPct: number;
  maxHoldMinutes: number;
  minLiquidityUsd: number;
  liquidityExitRatio: number;
  earlyExitLossPct: number;
  earlyExitTrend1hPct: number;
  momentumExitProfitPct: number;
  momentumExitTrend1hPct: number;
  momentumExitReboundPct: number;
  sellPressureExitRatio: number;
  sellPressureMinVolumeMon: number;
  profitTake1Pct: number;
  profitTake1SellPct: number;
  profitTake2Pct: number;
  profitTake2SellPct: number;
  profitTake3Pct: number;
  profitTake3SellPct: number;
  profitProtectionStartPct: number;
  profitProtectionFloorPct: number;
  profitProtectionRatio: number;
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
  const flowVolume = token?.volume5mMon ?? 0;

  // Protective conditions always win over profit-seeking AI guidance.
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
      flowVolume >= rules.sellPressureMinVolumeMon &&
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
