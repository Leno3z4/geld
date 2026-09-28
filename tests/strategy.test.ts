import test from "node:test";
import assert from "node:assert/strict";
import { SeasonalityModel, scoreToken, shouldClose } from "../src/strategy.js";

test("seasonality is neutral until a bucket has enough observations", () => {
  const m = new SeasonalityModel();
  const ts = Date.UTC(2026, 8, 29, 12);
  m.observe(ts, 5, 0);
  assert.equal(m.adjustment(ts), 0);
});

test("fresh positive flow scores above a weak baseline", () => {
  const m = new SeasonalityModel();
  const token = {
    token: "0x" + "1".repeat(40), symbol: "T", name: "Test",
    creator: "0x" + "2".repeat(40), pair: "0x" + "3".repeat(40),
    createdAt: Date.now(), lastEventAt: Date.now(),
    buys: 30, sells: 5, buyMon: 12, sellMon: 1,
    progressPct: 18, graduated: false, locked: false,
    holders: 10, volumeUsd: 1000, priceUsd: 1, priceMon: 1,
    peakPriceMon: 1, localScore: 0
  };
  assert.ok(scoreToken(token, m) > 35);
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
