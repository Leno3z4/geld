export async function scanLSTArbitrage(
  rpcUrl: string,
  cache?: LSTArbitrageCache
) {
  const assets = assetMap();
  const discovery = await discoverDexPaprikaPools(cache);
  const parsedPools = discovery.pools
    .map((record: any) => parseDexPaprikaPool(record, assets))
    .filter((pool: PoolRecord | null): pool is PoolRecord => pool !== null);

  const poolByAddress = new Map<string, PoolRecord>();
  for (const pool of KNOWN_UNISWAP_POOLS) poolByAddress.set(pool.address.toLowerCase(), pool);
  for (const pool of parsedPools) poolByAddress.set(pool.address.toLowerCase(), pool);
  const pools = [...poolByAddress.values()];

  const edges: PoolEdge[] = [];
  for (const pool of pools) addEdge(edges, pool);
  addKnownCurveEdges(edges);

  const wmon = assets.get("0x3bd359c1119da7da1d913d1c4d2b7c461115433a") ??
    ARBITRAGE_ASSETS.find(a => a.symbol === "WMON")!;
  const allRoutes = findCycles(edges, wmon.address.toLowerCase(), 3)
    .filter(route => route.exactQuoteSupported)
    .filter(route => new Set(route.legs.map((leg: PoolEdge) => leg.pool.toLowerCase())).size >= 2)
    .map(route => ({
      ...route,
      distinctDexes: new Set(route.legs.map((leg: PoolEdge) => leg.dex.toLowerCase())).size,
      distinctPools: new Set(route.legs.map((leg: PoolEdge) => leg.pool.toLowerCase())).size,
      liquidityScore: Math.min(...route.legs.map((leg: PoolEdge) => leg.liquidityUsd)),
      volumeScore: route.legs.reduce((sum: number, leg: PoolEdge) => sum + leg.volume24hUsd, 0)
    }))
    .sort((a, b) =>
      (b.distinctDexes - a.distinctDexes) ||
      (b.distinctPools - a.distinctPools) ||
      (b.grossEdgePct - a.grossEdgePct) ||
      (b.liquidityScore - a.liquidityScore) ||
      (b.volumeScore - a.volumeScore)
    );

  // Every indexed pool participates in topology discovery. Exact RPC work is
  // staged: probe up to 64 routes at 1 MON, then fully re-quote the strongest
  // 8 routes at every configured trade size. That avoids spending hundreds of
  // calls on 5/10 MON routes that already fail at the first probe size.
  const candidatePoolKeys = new Set<string>();
  const probeRoutes = allRoutes.filter(route => {
    const key = route.legs.map((leg: PoolEdge) => leg.pool.toLowerCase()).join("|");
    if (candidatePoolKeys.has(key)) return false;
    candidatePoolKeys.add(key);
    return true;
  }).slice(0, MAX_EXACT_ROUTES);

  const client = createClient(rpcUrl);
  const kuruParamsCache = new Map<string, any>();
  const uniswapFeeCache = new Map<string, number>();
  const v4KeyCache = new Map<string, {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  } | null>();

  const probes = await Promise.all(
    probeRoutes.map(async route => ({
      ...route,
      exactQuotes: [
        await simulateCycle(
          client,
          route,
          PROBE_SIZE_MON,
          kuruParamsCache,
          uniswapFeeCache,
          v4KeyCache
        )
      ],
      refined: false
    }))
  );

  const refinementRanks = probes
    .map((route, index) => ({ route, index }))
    .sort((a, b) => {
      const aq = a.route.exactQuotes[0];
      const bq = b.route.exactQuotes[0];
      const as = aq.ok === true ? Number(aq.netProfitMon) : -Infinity;
      const bs = bq.ok === true ? Number(bq.netProfitMon) : -Infinity;
      return (bs - as) ||
        (b.route.distinctDexes - a.route.distinctDexes) ||
        (b.route.distinctPools - a.route.distinctPools) ||
        (b.route.liquidityScore - a.route.liquidityScore);
    });

  const refineIndexes = new Set(
    refinementRanks
      .filter(item => item.route.exactQuotes[0].ok === true)
      .slice(0, MAX_REFINED_ROUTES)
      .map(item => item.index)
  );

  const refinedRoutes = await Promise.all(
    probes.map(async (route, index) => {
      if (!refineIndexes.has(index)) return route;
      const exactQuotes = await Promise.all(
        TRADE_SIZES_MON.map(size =>
          simulateCycle(
            client,
            route,
            size,
            kuruParamsCache,
            uniswapFeeCache,
            v4KeyCache
          )
        )
      );
      return { ...route, exactQuotes, refined: true };
    })
  );

  const signals: ArbitrageSignal[] = [];
  for (const route of refinedRoutes) {
    for (const q of route.exactQuotes) {
      if (q.ok !== true || q.candidate !== true) continue;
      signals.push({
        path: route.path, sizeMon: q.sizeMon, amountInRaw: parseUnits(String(q.sizeMon), 18).toString(),
        finalMon: q.finalMon, finalQuoteRaw: q.finalQuoteRaw, protectedFinalMon: q.protectedFinalMon,
        protectedFinalRaw: q.protectedFinalRaw, minFinalWmonRaw: q.minFinalWmonRaw, grossProfitMon: q.grossProfitMon,
        executionBufferMon: q.executionBufferMon, netProfitMon: q.netProfitMon,
        legs: q.exactLegs.map((leg: any) => ({
          pool: leg.pool, tokenIn: leg.tokenIn, tokenOut: leg.tokenOut, from: leg.from, to: leg.to,
          venue: leg.venue, dex: leg.dex, quoteKind: leg.quoteKind, feePct: leg.feePct, feeBps: leg.feeBps,
          curveI: leg.curveI, curveJ: leg.curveJ, amountInRaw: leg.amountInRaw, quoteAmountOutRaw: leg.quoteAmountOutRaw,
          minAmountOutRaw: leg.minAmountOutRaw
        })),
        liveExecutable: false
      });
    }
  }
  signals.sort((a, b) => b.netProfitMon - a.netProfitMon);

  return {
    mode: "PAPER_SIGNAL_ONLY" as const,
    generatedAt: new Date().toISOString(),
    rpcUrl,
    assets: ARBITRAGE_ASSETS,
    poolCount: pools.length,
    edgeCount: edges.length,
    triangleCount: allRoutes.length,
    routeCount: allRoutes.length,
    probeRouteCount: probeRoutes.length,
    refinedRouteCount: refinedRoutes.filter(route => route.refined).length,
    routes: refinedRoutes,
    signals,
    topSignal: signals[0] ?? null,
    thresholds: {
      minimumLiquidityUsd: MIN_LIQUIDITY_USD,
      minimumGrossEdgePct: MIN_GROSS_EDGE_PCT,
      executionBufferPct: EXECUTION_BUFFER_PCT,
      minimumNetProfitMon: MIN_NET_PROFIT_MON,
      gasBufferMon: GAS_BUFFER_MON,
      tradeSizesMon: TRADE_SIZES_MON,
      probeSizeMon: PROBE_SIZE_MON
    },
    provider: {
      name: "DexPaprika network-wide paginated discovery",
      requestsThisScan: discovery.provider.requestsThisScan,
      cached: discovery.provider.cached ?? false,
      stale: discovery.provider.stale ?? false,
      poolCount: discovery.pools.length,
      parsedPoolCount: parsedPools.length,
      truncated: discovery.provider.truncated ?? false,
      queryMode: discovery.provider.queryMode ?? "network_wide_paginated",
      externalMarketDataRequired: false,
      discoveredDexes: [...new Set(pools.map(p => p.dex))].sort(),
      supportedQuoteKinds: [...new Set(pools.filter(p => p.quoteKind !== "unsupported").map(p => p.quoteKind))].sort(),
      unsupportedQuoteKinds: [...new Set(pools.filter(p => p.quoteKind === "unsupported").map(p => p.dex))].sort(),
      note: "The topology scan pages through the indexed Monad pool set, then ranks cycles for exact sequential on-chain quote probing. Each leg receives the exact output of the prior leg; no fixed rate is used for profitability acceptance."
    },
    execution: {
      live: false,
      transactionsSubmitted: 0,
      reason: "Paper-only scanner. No transaction submission is performed."
    }
  };
}
