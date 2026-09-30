import test from "node:test";
import assert from "node:assert/strict";
import { SeasonalityModel, positionExitSignal, scoreToken, shouldClose } from "../src/strategy.js";

test("seasonality is neutral until a bucket has enough observations", () => {
  const m = new SeasonalityModel();
  const ts = Date.UTC(2026, 8, 29, 12);
  m.observe(ts, 5, 0);
  assert.equal(m.adjustment(ts), 0);
});

test("established pullback scores above a fresh launch", () => {
  const m = new SeasonalityModel();
  const now = Date.now();
  const token = {
    token: "0x" + "1".repeat(40), symbol: "T", name: "Test",
    creator: "0x" + "2".repeat(40), pair: "0x" + "3".repeat(40),
    createdAt: now - 3 * 60 * 60 * 1000, lastEventAt: now,
    buys: 40, sells: 25, buyMon: 80, sellMon: 45,
    progressPct: 100, graduated: true, locked: false,
    holders: 250, volumeUsd: 0, priceUsd: 0, priceMon: 0.08,
    peakPriceMon: 0.1, localScore: 0,
    liquidityMon: 80, volumeMon: 500, changePct: 12,
    priceHistory: [
      { ts: now - 4 * 60 * 60 * 1000, priceMon: 0.075 },
      { ts: now - 3 * 60 * 60 * 1000, priceMon: 0.1 },
      { ts: now - 2 * 60 * 60 * 1000, priceMon: 0.095 },
      { ts: now - 60 * 60 * 1000, priceMon: 0.075 },
      { ts: now, priceMon: 0.08 }
    ]
  };
  assert.ok(scoreToken(token, m) > 50);
});

test("hard stop exits a large losing position", () => {
  const p = {
    id: "p", token: "0x" + "1".repeat(40), symbol: "T",
    amountRaw: "100", decimals: 18, entryMon: 1, entryPriceMon: 0.01,
    currentMon: 0.7, pnlMon: -0.3, pnlPct: -30, peakMon: 1,
    openedAt: Date.now() - 60000, lastAiAt: 0, entryTx: "PAPER",
    status: "OPEN" as const
  };
  assert.equal(shouldClose(p, 22, 55, 16, 180), "HARD_STOP");
});


test("rolling flow detects stronger recent buying pressure", () => {
  const token = {
    token: "0x" + "4".repeat(40), symbol: "FLOW", name: "Flow",
    creator: "0x" + "5".repeat(40), pair: "0x" + "6".repeat(40),
    createdAt: Date.now() - 60 * 60 * 1000, lastEventAt: Date.now(),
    buys: 10, sells: 5, buyMon: 100, sellMon: 50,
    progressPct: 100, graduated: true, locked: false,
    holders: 100, volumeUsd: 0, priceUsd: 0, priceMon: 1,
    peakPriceMon: 1.2, localScore: 70,
    liquidityMon: 4000000, liquidityUsd: 120000,
    volumeMon: 500, flowHistory: [
      { ts: Date.now() - 8 * 60 * 1000, buyMon: 20, sellMon: 20 },
      { ts: Date.now() - 4 * 60 * 1000, buyMon: 60, sellMon: 20 }
    ]
  };
  const m = new SeasonalityModel();
  // updateMarketMetrics is intentionally tested through scoreToken's flow contribution.
  assert.ok(scoreToken(token, m) >= 70);
});

test("profit protection exits a winner before it round-trips", () => {
  const now = Date.now();
  const position = {
    id: "p2", token: "0x" + "7".repeat(40), symbol: "WIN",
    amountRaw: "100", decimals: 18, entryMon: 10, entryPriceMon: 1,
    currentMon: 11, pnlMon: 1, pnlPct: 10, realizedPnlMon: 0,
    peakMon: 13, peakPnlPct: 30, openedAt: now - 20 * 60000, lastAiAt: 0,
    entryTx: "PAPER", status: "OPEN" as const
  };
  const token = {
    token: position.token, symbol: "WIN", name: "Winner",
    creator: "", pair: "", createdAt: now - 3 * 60 * 60 * 1000, lastEventAt: now,
    buys: 20, sells: 10, buyMon: 200, sellMon: 100,
    progressPct: 100, graduated: true, locked: false,
    holders: 200, volumeUsd: 0, priceUsd: 0, priceMon: 1,
    peakPriceMon: 1, localScore: 80, liquidityUsd: 150000,
    trendPct1h: 1, reboundPct1h: 1, dipPct: 12,
    buySellRatio5m: 1.2, volume5mMon: 100, volumeAcceleration5m: 1.1
  };
  const signal = positionExitSignal(position, token, {
    hardStopPct: 18, takeProfitPct: 70, trailingPct: 12, maxHoldMinutes: 180,
    minLiquidityUsd: 100000, liquidityExitRatio: 0.65,
    earlyExitLossPct: -10, earlyExitTrend1hPct: -8,
    momentumExitProfitPct: 8, momentumExitTrend1hPct: -10, momentumExitReboundPct: 2,
    sellPressureExitRatio: 0.65, sellPressureMinVolumeMon: 20,
    profitTake1Pct: 15, profitTake1SellPct: 25,
    profitTake2Pct: 30, profitTake2SellPct: 33,
    profitTake3Pct: 50, profitTake3SellPct: 50,
    profitProtectionStartPct: 12, profitProtectionFloorPct: 5,
    profitProtectionRatio: 0.40
  });
  assert.equal(signal?.reason, "PROFIT_PROTECTION");
});

test("early exit cuts a deteriorating loser before the hard stop", () => {
  const now = Date.now();
  const position = {
    id: "p3", token: "0x" + "8".repeat(40), symbol: "LOSER",
    amountRaw: "100", decimals: 18, entryMon: 10, entryPriceMon: 1,
    currentMon: 9, pnlMon: -1, pnlPct: -10, realizedPnlMon: 0,
    peakMon: 10, peakPnlPct: 0, openedAt: now - 20 * 60000, lastAiAt: 0,
    entryTx: "PAPER", status: "OPEN" as const, entryLiquidityUsd: 150000
  };
  const token = {
    token: position.token, symbol: "LOSER", name: "Loser",
    creator: "", pair: "", createdAt: now - 3 * 60 * 60 * 1000, lastEventAt: now,
    buys: 20, sells: 30, buyMon: 100, sellMon: 200,
    progressPct: 100, graduated: true, locked: false,
    holders: 200, volumeUsd: 0, priceUsd: 0, priceMon: 1,
    peakPriceMon: 1, localScore: 60, liquidityUsd: 145000,
    trendPct1h: -10, reboundPct1h: 0, dipPct: 25,
    buySellRatio5m: 0.6, volume5mMon: 100, volumeAcceleration5m: 1.4
  };
  const signal = positionExitSignal(position, token, {
    hardStopPct: 18, takeProfitPct: 70, trailingPct: 12, maxHoldMinutes: 180,
    minLiquidityUsd: 100000, liquidityExitRatio: 0.65,
    earlyExitLossPct: -10, earlyExitTrend1hPct: -8,
    momentumExitProfitPct: 8, momentumExitTrend1hPct: -10, momentumExitReboundPct: 2,
    sellPressureExitRatio: 0.65, sellPressureMinVolumeMon: 20,
    profitTake1Pct: 15, profitTake1SellPct: 25,
    profitTake2Pct: 30, profitTake2SellPct: 33,
    profitTake3Pct: 50, profitTake3SellPct: 50,
    profitProtectionStartPct: 12, profitProtectionFloorPct: 5,
    profitProtectionRatio: 0.40
  });
  assert.equal(signal?.reason, "EARLY_MOMENTUM_STOP");
});
