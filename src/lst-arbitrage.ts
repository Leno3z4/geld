export async function scanLSTArbitrage(
  rpcUrl: string,
  cache?: LSTArbitrageCache
) {
  const assets = assetMap();
  const discovery = await discoverDexPaprikaPools(cache);

  const discoveredPools = discovery.pools
    .map((record: any) => parseDexPaprikaPool(record, assets))
    .filter((pool: PoolRecord | null): pool is PoolRecord =>
      Boolean(pool) &&
      pool.liquidityUsd >= MIN_LIQUIDITY_USD &&
      pool.base !== pool.quote
    );

  // Keep the known Curve LST pool even if the public indexer is temporarily
  // stale, and keep the previously verified Uniswap LST pools as a safety net.
  const poolByAddress = new Map<string, PoolRecord>();
  for (const pool of KNOWN_UNISWAP_POOLS) poolByAddress.set(pool.address.toLowerCase(), pool);
  for (const pool of discoveredPools) poolByAddress.set(pool.address.toLowerCase(), pool);

  const pools = [...poolByAddress.values()];
  const edges: PoolEdge[] = [];
  for (const pool of pools) addEdge(edges, pool);
  addKnownCurveEdges(edges);

  const wmon = ARBITRAGE_ASSETS.find(a => a.symbol === "WMON")!;

  const allRoutes = findTriangles(edges, wmon.address.toLowerCase())
    .filter(route => route.exactQuoteSupported)
    .filter(route => new Set(route.legs.map(leg => leg.pool.toLowerCase())).size >= 2)
    .map(route => ({
      ...route,
      distinctDexes: new Set(route.legs.map(leg => leg.dex.toLowerCase())).size,
      distinctPools: new Set(route.legs.map(leg => leg.pool.toLowerCase())).size,
      liquidityScore: Math.min(...route.legs.map(leg => leg.liquidityUsd)),
      volumeScore: route.legs.reduce((sum, leg) => sum + leg.volume24hUsd, 0)
    }))
    .sort((a, b) =>
      (b.distinctDexes - a.distinctDexes) ||
      (b.distinctPools - a.distinctPools) ||
      (b.liquidityScore - a.liquidityScore) ||
      (b.volumeScore - a.volumeScore)
    );

  // Free Workers have a 50 external-subrequest budget. Four routes × three
  // sizes × three legs stays comfortably inside that budget while still
  // comparing multiple venues. More routes can be enabled on paid Workers.
  const triangles = allRoutes.slice(0, MAX_EXACT_TRIANGLES);
  const client = createClient(rpcUrl);
  const kuruParamsCache = new Map<string, any>();

  const exactResults = await Promise.all(
    triangles.map(async route => {
      const exactQuotes = await Promise.all(
        TRADE_SIZES_MON.map(size => simulateTriangle(client, route, size, kuruParamsCache))
      );
      return { ...route, exactQuotes };
    })
  );

  const signals: ArbitrageSignal[] = [];
  for (const route of exactResults) {
    for (const q of route.exactQuotes) {
      if (q.ok !== true || q.candidate !== true) continue;
      signals.push({
        path: route.path,
        sizeMon: q.sizeMon,
        amountInRaw: parseUnits(String(q.sizeMon), 18).toString(),
        finalMon: q.finalMon,
        finalQuoteRaw: q.finalQuoteRaw,
        protectedFinalMon: q.protectedFinalMon,
        protectedFinalRaw: q.protectedFinalRaw,
        minFinalWmonRaw: q.minFinalWmonRaw,
        grossProfitMon: q.grossProfitMon,
        executionBufferMon: q.executionBufferMon,
        netProfitMon: q.netProfitMon,
        legs: q.exactLegs.map(leg => ({
          pool: leg.pool,
          tokenIn: leg.tokenIn,
          tokenOut: leg.tokenOut,
          from: leg.from,
          to: leg.to,
          venue: leg.venue,
          dex: leg.dex,
          quoteKind: leg.quoteKind,
          feePct: leg.feePct,
          feeBps: leg.feeBps,
          curveI: leg.curveI,
          curveJ: leg.curveJ,
          amountInRaw: leg.amountInRaw,
          quoteAmountOutRaw: leg.quoteAmountOutRaw,
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
    routes: exactResults,
    signals,
    topSignal: signals[0] ?? null,
    thresholds: {
      minimumLiquidityUsd: MIN_LIQUIDITY_USD,
      minimumGrossEdgePct: MIN_GROSS_EDGE_PCT,
      executionBufferPct: EXECUTION_BUFFER_PCT,
      minimumNetProfitMon: MIN_NET_PROFIT_MON,
      gasBufferMon: GAS_BUFFER_MON,
      tradeSizesMon: TRADE_SIZES_MON
    },
    provider: {
      name: "DexPaprika + on-chain known pools",
      requestsThisScan: discovery.provider.requestsThisScan,
      cached: discovery.provider.cached ?? false,
      stale: discovery.provider.stale ?? false,
      externalMarketDataRequired: false,
      discoveredDexes: [...new Set(pools.map(p => p.dex))].sort(),
      supportedQuoteKinds: [...new Set(pools.filter(p => p.quoteKind !== "unsupported").map(p => p.quoteKind))].sort(),
      note: "Discovery spans indexed Monad DEX pools; profitability is accepted only after exact sequential on-chain quotes."
    },
    execution: {
      live: false,
      transactionsSubmitted: 0,
      reason: "Arbitrage execution is disabled; this endpoint only discovers and simulates routes."
    }
  };
}