import test from "node:test";
import assert from "node:assert/strict";
import { SeasonalityModel, scoreToken, shouldClose } from "../src/strategy.js";

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
