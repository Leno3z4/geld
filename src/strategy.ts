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

  adjustment(ts = Date.now()) {
    const b = this.buckets.get(hourOfWeek(ts));
    if (!b || b.events < 20) return 0;
    const denom = b.buyMon + b.sellMon;
    if (!denom) return 0;
    return clamp(((b.buyMon - b.sellMon) / denom) * 10, -8, 8);
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
  const seasonalityAdjustment = seasonality.adjustment();

  return Math.round(clamp(
    liquidityScore +
    holderScore +
    volumeScore +
    momentumScore +
    dipScore +
    reboundScore +
    seasonalityAdjustment,
    0,
    100
  ));
}

export function shouldWatch(token: TokenSnapshot, minLiquidityMon: number, minHolders: number, minVolumeMon: number) {
  return (
    token.graduated &&
    !token.locked &&
    (token.liquidityMon ?? 0) >= minLiquidityMon &&
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
  minLiquidityMon: number,
  minHolders: number,
  minVolumeMon: number,
  dipMinPct: number,
  dipMaxPct: number,
  recoveryMinPct: number,
  trendMax1hPct: number
) {
  const age = ageMinutes(token);
  const metrics = historyMetrics(token);

  return (
    token.graduated &&
    !token.locked &&
    age >= minEstablishedAgeMinutes &&
    (token.liquidityMon ?? 0) >= minLiquidityMon &&
    (token.holders ?? 0) >= minHolders &&
    (token.volumeMon ?? 0) >= minVolumeMon &&
    metrics.dipPct >= dipMinPct &&
    metrics.dipPct <= dipMaxPct &&
    metrics.rebound1hPct >= recoveryMinPct &&
    metrics.trend1hPct <= trendMax1hPct &&
    token.localScore >= minScore &&
    confidence >= minConfidence
  );
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
