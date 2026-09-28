import type { Position, TokenSnapshot } from "./types.js";

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function hourOfWeek(ts = Date.now()) {
  const d = new Date(ts);
  return d.getUTCDay() * 24 + d.getUTCHours();
}

export interface MarketBucket { buyMon: number; sellMon: number; events: number; }

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

export function scoreToken(token: TokenSnapshot, seasonality: SeasonalityModel) {
  const age = Math.max(0, (Date.now() - token.createdAt) / 1000);
  const freshness = age <= 15 ? 18 : age <= 45 ? 14 : age <= 90 ? 8 : 0;

  const flowDenom = token.buyMon + token.sellMon;
  const flow = flowDenom ? (token.buyMon - token.sellMon) / flowDenom : 0;
  const flowScore = clamp(25 + flow * 25, 0, 50) * 0.55;

  const tx = token.buys + token.sells;
  const buyRate = tx / Math.max(1, age / 60);
  const velocity = clamp(buyRate * 1.2, 0, 14);

  const p = token.progressPct;
  const curveStage = p < 5 ? 4 : p < 35 ? 14 : p < 70 ? 8 : p < 95 ? 4 : -4;
  const liquidity = clamp(Math.log10(Math.max(1, token.buyMon + token.sellMon)) * 3.5, 0, 10);
  const lifecycle = token.graduated ? -18 : token.locked ? -20 : 0;
  return Math.round(clamp(freshness + flowScore + velocity + curveStage + liquidity + seasonality.adjustment() + lifecycle, 0, 100));
}

export function shouldOpen(token: TokenSnapshot, confidence: number, minScore: number) {
  return !token.graduated && !token.locked && token.localScore >= minScore && confidence >= 0.62;
}

export function shouldClose(position: Position, hardStopPct: number, takeProfitPct: number, trailingPct: number, maxHoldMinutes: number) {
  const held = (Date.now() - position.openedAt) / 60000;
  if (position.pnlPct <= -hardStopPct) return "HARD_STOP";
  if (position.pnlPct >= takeProfitPct) return "TAKE_PROFIT";
  const peakDraw = position.peakMon > position.entryMon ? (position.currentMon / position.peakMon - 1) * 100 : 0;
  if (position.peakMon > position.entryMon && peakDraw <= -trailingPct) return "TRAILING_STOP";
  if (held >= maxHoldMinutes) return "MAX_HOLD";
  return null;
}
