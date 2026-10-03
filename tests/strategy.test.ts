});


test("daily mean reversion is one distinct entry strategy", () => {
  const token = {
    token: "0x" + "c".repeat(40), symbol: "MEAN", name: "Mean",
    creator: "", pair: "", createdAt: Date.now() - 10 * 60 * 60 * 1000, lastEventAt: Date.now(),
    buys: 100, sells: 90, buyMon: 300, sellMon: 250,
    progressPct: 100, graduated: true, locked: false, holders: 500,
    volumeUsd: 0, priceUsd: 1, priceMon: 1, peakPriceMon: 1.2, localScore: 80,
    liquidityUsd: 50000, marketCapUsd: 500000, volumeMon: 5000,
    daySamples: 60, dayLowPriceMon: 0.98, dayAvgPriceMon: 1.12,
    distanceFromDayLowPct: 2.04, distanceFromDayAvgPct: -10.71,
    dipPct: 15, trendPct1h: -1, trendPct4h: 2, reboundPct1h: 2,
    buySellRatio5m: 1.1, volume5mMon: 800, volumeAcceleration5m: 1.2, monUsdPrice: 0.033
  };
  assert.equal(selectEntryStrategy(token), "DAILY_MEAN_REVERSION");
});

test("daily mean reversion exits when price returns to the rolling daily average", () => {
  const now = Date.now();
  const position = {
    id: "mean-exit", token: "0x" + "d".repeat(40), symbol: "MEANEXIT",
    amountRaw: "100", decimals: 18, entryMon: 10, entryPriceMon: 1,
    currentMon: 10.2, pnlMon: 0.2, pnlPct: 2, peakMon: 10.2, peakPnlPct: 3,
    openedAt: now - 25 * 60000, lastAiAt: 0, entryTx: "PAPER",
    status: "OPEN" as const, strategy: "DAILY_MEAN_REVERSION" as const
  };
  const token = {
    token: position.token, symbol: "MEANEXIT", name: "Mean Exit",
    creator: "", pair: "", createdAt: now - 8 * 60 * 60 * 1000, lastEventAt: now,
    buys: 20, sells: 10, buyMon: 100, sellMon: 50,
    progressPct: 100, graduated: true, locked: false, holders: 300,
    volumeUsd: 0, priceUsd: 0, priceMon: 1, peakPriceMon: 1.1, localScore: 85,
    liquidityUsd: 50000, marketCapUsd: 500000, volumeMon: 500,
    trendPct1h: 1, trendPct4h: 2,
    daySamples: 40, dayLowPriceMon: 0.95, dayAvgPriceMon: 1,
    distanceFromDayLowPct: 7, distanceFromDayAvgPct: 0,
    dipPct: 8, reboundPct1h: 2, buySellRatio5m: 1.1, volume5mMon: 50
  };
  const signal = positionExitSignal(position, token, {
    hardStopPct: 22, takeProfitPct: 55, trailingPct: 15, maxHoldMinutes: 180,
    staleLossExitMinutes: 45, staleLossExitPct: -4,
    deadMoneyExitMinutes: 90, deadMoneyMaxPnlPct: 3,
    dustPositionMon: 0.05, dailyMeanExitPct: 1.5, dailyMinSamples: 24,
    minLiquidityUsd: 5000, liquidityExitRatio: 0.65,
    earlyExitLossPct: -10, earlyExitTrend1hPct: -8,
    momentumExitProfitPct: 8, momentumExitTrend1hPct: -10, momentumExitReboundPct: 2,
    sellPressureExitRatio: 0.65, sellPressureMinVolumeUsd: 20,
    profitTake1Pct: 3, profitTake1SellPct: 40,
    profitTake2Pct: 30, profitTake2SellPct: 35,
    profitTake3Pct: 50, profitTake3SellPct: 100,
    profitProtectionStartPct: 12, profitProtectionFloorPct: 5,
    profitProtectionRatio: 0.40
  });
  assert.equal(signal?.reason, "DAILY_MEAN_REVERSION_EXIT");
});

test("stale losing positions are fully exited", () => {
  const now = Date.now();
  const position = {
    id: "stale", token: "0x" + "e".repeat(40), symbol: "STALE",
    amountRaw: "100", decimals: 18, entryMon: 10, entryPriceMon: 1,
    currentMon: 9.5, pnlMon: -0.5, pnlPct: -5, peakMon: 10, peakPnlPct: 0,
    openedAt: now - 60 * 60000, lastAiAt: 0, entryTx: "PAPER",
    status: "OPEN" as const
  };
  const token = {
    token: position.token, symbol: "STALE", name: "Stale",
    creator: "", pair: "", createdAt: now - 6 * 60 * 60 * 1000, lastEventAt: now,
    buys: 20, sells: 20, buyMon: 100, sellMon: 100,
    progressPct: 100, graduated: true, locked: false, holders: 200,
    volumeUsd: 0, priceUsd: 0, priceMon: 1, peakPriceMon: 1.1, localScore: 60,
    liquidityUsd: 50000, trendPct1h: -1, trendPct4h: -2, dipPct: 10
  };
  const signal = positionExitSignal(position, token, {
    hardStopPct: 22, takeProfitPct: 55, trailingPct: 15, maxHoldMinutes: 180,
    staleLossExitMinutes: 45, staleLossExitPct: -4,
    deadMoneyExitMinutes: 90, deadMoneyMaxPnlPct: 3,
    dustPositionMon: 0.05, dailyMeanExitPct: 1.5, dailyMinSamples: 24,
    minLiquidityUsd: 5000, liquidityExitRatio: 0.65,
    earlyExitLossPct: -10, earlyExitTrend1hPct: -8,
    momentumExitProfitPct: 8, momentumExitTrend1hPct: -10, momentumExitReboundPct: 2,
    sellPressureExitRatio: 0.65, sellPressureMinVolumeUsd: 20,
    profitTake1Pct: 3, profitTake1SellPct: 40,
    profitTake2Pct: 30, profitTake2SellPct: 35,
    profitTake3Pct: 50, profitTake3SellPct: 100,
    profitProtectionStartPct: 12, profitProtectionFloorPct: 5,
    profitProtectionRatio: 0.40
  });
  assert.equal(signal?.reason, "STALE_LOSS_EXIT");
});


test("blocks established dip entries until price rebounds with positive flow", () => {
  const now = Date.now();
  const token = {
    token: "0x" + "f".repeat(40), symbol: "KNIFE", name: "Knife Catch",
    creator: "", pair: "", createdAt: now - 3 * 60 * 60 * 1000, lastEventAt: now,
    buys: 80, sells: 90, buyMon: 500, sellMon: 600, progressPct: 100,
    graduated: true, locked: false, holders: 300, volumeUsd: 0,
    priceUsd: 1, priceMon: 0.09, peakPriceMon: 0.11, localScore: 85,
    liquidityUsd: 80000, liquidityMon: 2500000, marketCapUsd: 120000,
    volumeMon: 5000, changePct: -8,
    dipPct: 18, trendPct1h: -5, trendPct4h: -4,
    reboundPct1h: 0.2, buySellRatio5m: 0.95, volume5mMon: 10,
    monUsdPrice: 0.033, dayLowPriceMon: 0.089, dayAvgPriceMon: 0.10,
    distanceFromDayLowPct: 1, distanceFromDayAvgPct: -10,
    daySamples: 60
  };
  const d = entryGateDiagnostics(token, {
    minEstablishedAgeMinutes: 30, minLiquidityUsd: 5000,
    minMarketCapUsd: 60000, minHolders: 25, minVolumeUsd: 100,
    dipMinPct: 8, dipMaxPct: 35, recoveryMinPct: 1,
    trendMax1hPct: 20, minTrend4hPct: -12, minLocalScore: 50
  });
  assert.ok(d.blockers.some((x) => x.includes("rebound")));
  assert.ok(d.blockers.some((x) => x.includes("5m buy/sell")));
});

test("allows an established dip only after rebound and buying flow confirm", () => {
  const now = Date.now();
  const token = {
    token: "0x" + "a".repeat(40), symbol: "REV", name: "Confirmed Reversal",
    creator: "", pair: "", createdAt: now - 3 * 60 * 60 * 1000, lastEventAt: now,
    buys: 100, sells: 70, buyMon: 600, sellMon: 400, progressPct: 100,
    graduated: true, locked: false, holders: 500, volumeUsd: 0,
    priceUsd: 1, priceMon: 0.103, peakPriceMon: 0.12, localScore: 85,
    liquidityUsd: 90000, liquidityMon: 3000000, marketCapUsd: 150000,
    volumeMon: 5000, changePct: 2,
    dipPct: 14, trendPct1h: 3, trendPct4h: 1,
    reboundPct1h: 2.5, buySellRatio5m: 1.25, volume5mMon: 1000,
    monUsdPrice: 0.033, dayLowPriceMon: 0.10, dayAvgPriceMon: 0.112,
    distanceFromDayLowPct: 3, distanceFromDayAvgPct: -8,
    daySamples: 60
  };
  const d = entryGateDiagnostics(token, {
    minEstablishedAgeMinutes: 30, minLiquidityUsd: 5000,
    minMarketCapUsd: 60000, minHolders: 25, minVolumeUsd: 100,
    dipMinPct: 8, dipMaxPct: 35, recoveryMinPct: 1,
    trendMax1hPct: 20, minTrend4hPct: -12, minLocalScore: 50
  });
  assert.equal(d.blockers.length, 0);
});