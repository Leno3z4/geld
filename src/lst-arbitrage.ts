const MONAD_NETWORK = "monad";

const MIN_LIQUIDITY_USD = 5_000;
const MIN_GROSS_EDGE_PCT = 0.50;
const SLIPPAGE_BUFFER_PCT = 0.45;
const GAS_BUFFER_MON = 0.001;
const TRADE_SIZES_MON = [1, 5, 10];

export type ArbitrageAsset = {
  symbol: string;
  address: string;
  decimals: number;
};

export const ARBITRAGE_ASSETS: ArbitrageAsset[] = [
  { symbol: "WMON", address: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a", decimals: 18 },
  { symbol: "shMON", address: "0x1b68626dca36c7fe922fd2d55e4f631d962de19c", decimals: 18 },
  { symbol: "sMON", address: "0xa3227c5969757783154c60bf0bc1944180ed81b9", decimals: 18 },
  { symbol: "gMON", address: "0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081", decimals: 18 },
  { symbol: "aprMON", address: "0x0c65a0bc65a5d819235b71f554d210d3f80e0852", decimals: 18 },
  { symbol: "USDC", address: "0x754704bc059f8c67012fed69bc8a327a5aafb603", decimals: 6 }
];

type PoolEdge = {
  pool: string;
  venue: string;
  from: string;
  to: string;
  fromSymbol: string;
  toSymbol: string;
  rate: number;
  feePct: number;
  liquidityUsd: number;
  volume24hUsd: number;
  pricingBasis: "pool-spot" | "multi-asset-indicative";
};

type PoolRecord = {
  id: string;
  name: string;
  address: string;
  base: string;
  quote: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseToQuote: number;
  feePct: number;
  liquidityUsd: number;
  volume24hUsd: number;
  dex: string;
};

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function addr(value: unknown) {
  const raw = String(value ?? "");
  const match = raw.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0].toLowerCase() : "";
}

function assetMap() {
  return new Map(ARBITRAGE_ASSETS.map(a => [a.address.toLowerCase(), a]));
}

async function fetchJson(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json() as Promise<any>;
}

async function fetchTokenPools(asset: ArbitrageAsset) {
  const url =
    `https://api.geckoterminal.com/api/v2/networks/${MONAD_NETWORK}/tokens/${asset.address}/pools?page=1&include=base_token,quote_token,dex`;
  const json = await fetchJson(url);
  return Array.isArray(json?.data) ? json.data : [];
}

async function fetchTokenPrices() {
  const ids = ARBITRAGE_ASSETS.map(a => a.address).join(",");
  const json = await fetchJson(
    `https://api.geckoterminal.com/api/v2/simple/networks/${MONAD_NETWORK}/token_price/${ids}`
  );
  return (json?.data?.attributes?.token_prices ?? {}) as Record<string, string>;
}

function parsePool(record: any, assets: Map<string, ArbitrageAsset>): PoolRecord | null {
  const a = record?.attributes ?? {};
  const relationships = record?.relationships ?? {};

  const base =
    addr(relationships?.base_token?.data?.id) ||
    addr(a?.base_token_address) ||
    addr(record?.base_token?.address);

  const quote =
    addr(relationships?.quote_token?.data?.id) ||
    addr(a?.quote_token_address) ||
    addr(record?.quote_token?.address);

  if (!base || !quote || base === quote) return null;

  const baseAsset = assets.get(base);
  const quoteAsset = assets.get(quote);
  if (!baseAsset || !quoteAsset) return null;

  const baseToQuote = num(a.base_token_price_quote_token);
  if (!(baseToQuote > 0)) return null;

  const feePct = num(a.pool_fee_percentage ?? a.fee_percentage ?? a.pool_fee);
  const liquidityUsd = num(a.reserve_in_usd);
  const volume24hUsd = num(a.volume_usd?.h24);

  return {
    id: String(record?.id ?? ""),
    name: String(a.name ?? `${baseAsset.symbol}/${quoteAsset.symbol}`),
    address: String(a.address ?? record?.id ?? ""),
    base,
    quote,
    baseSymbol: baseAsset.symbol,
    quoteSymbol: quoteAsset.symbol,
    baseToQuote,
    feePct,
    liquidityUsd,
    volume24hUsd,
    dex: String(record?.relationships?.dex?.data?.id ?? "unknown")
  };
}

function addEdge(edges: PoolEdge[], pool: PoolRecord) {
  if (pool.liquidityUsd < MIN_LIQUIDITY_USD) return;

  const feeMultiplier = Math.max(0, 1 - pool.feePct / 100);

  edges.push({
    pool: pool.address,
    venue: pool.name,
    from: pool.base,
    to: pool.quote,
    fromSymbol: pool.baseSymbol,
    toSymbol: pool.quoteSymbol,
    rate: pool.baseToQuote * feeMultiplier,
    feePct: pool.feePct,
    liquidityUsd: pool.liquidityUsd,
    volume24hUsd: pool.volume24hUsd,
    pricingBasis: "pool-spot"
  });

  edges.push({
    pool: pool.address,
    venue: pool.name,
    from: pool.quote,
    to: pool.base,
    fromSymbol: pool.quoteSymbol,
    toSymbol: pool.baseSymbol,
    rate: (1 / pool.baseToQuote) * feeMultiplier,
    feePct: pool.feePct,
    liquidityUsd: pool.liquidityUsd,
    volume24hUsd: pool.volume24hUsd,
    pricingBasis: "pool-spot"
  });
}

function addIndicativeCurveEdges(
  edges: PoolEdge[],
  tokenPrices: Record<string, string>
) {
  const curveAddress = "0x74d80ee400d3026fdd2520265cc98300710b25d4";
  const curveSymbols = ["WMON", "shMON", "sMON", "gMON"];
  const bySymbol = new Map(ARBITRAGE_ASSETS.map(a => [a.symbol, a]));

  // Curve is a four-token LST pool. GeckoTerminal's ordinary pool response
  // exposes one base/quote pair, so these internal LST↔LST edges are derived
  // from current network token prices as an INDICATIVE discovery signal only.
  // Live mode must replace each leg with an exact Curve/router quote.
  for (const fromSymbol of curveSymbols) {
    for (const toSymbol of curveSymbols) {
      if (fromSymbol === toSymbol) continue;
      const from = bySymbol.get(fromSymbol);
      const to = bySymbol.get(toSymbol);
      if (!from || !to) continue;

      const fromUsd = num(tokenPrices[from.address]);
      const toUsd = num(tokenPrices[to.address]);
      if (!(fromUsd > 0) || !(toUsd > 0)) continue;

      edges.push({
        pool: curveAddress,
        venue: "Curve LST multi-pool (indicative)",
        from: from.address,
        to: to.address,
        fromSymbol,
        toSymbol,
        rate: fromUsd / toUsd,
        feePct: 0,
        liquidityUsd: 0,
        volume24hUsd: 0,
        pricingBasis: "multi-asset-indicative"
      });
    }
  }
}

function findTriangles(edges: PoolEdge[], startAddress: string) {
  const byFrom = new Map<string, PoolEdge[]>();
  for (const edge of edges) {
    const list = byFrom.get(edge.from) ?? [];
    list.push(edge);
    byFrom.set(edge.from, list);
  }

  const results = [];
  const seen = new Set<string>();

  for (const first of byFrom.get(startAddress) ?? []) {
    if (first.to === startAddress) continue;

    for (const second of byFrom.get(first.to) ?? []) {
      if (second.to === startAddress || second.to === first.from) continue;

      for (const third of byFrom.get(second.to) ?? []) {
        if (third.to !== startAddress) continue;

        const pools = [first.pool, second.pool, third.pool];
        const key = [
          first.from,
          first.to,
          second.to,
          ...pools.sort()
        ].join(":");

        if (seen.has(key)) continue;
        seen.add(key);

        const multiplier = first.rate * second.rate * third.rate;
        const grossEdgePct = (multiplier - 1) * 100;

        results.push({
          path: [
            first.fromSymbol,
            second.fromSymbol,
            third.fromSymbol,
            first.fromSymbol
          ],
          assets: [
            first.from,
            first.to,
            second.to,
            first.from
          ],
          legs: [first, second, third],
          multiplier,
          grossEdgePct
        });
      }
    }
  }

  return results.sort((a, b) => b.grossEdgePct - a.grossEdgePct);
}

export async function scanLSTArbitrage() {
  const assets = assetMap();

  // One pool-discovery call per configured asset. This is deliberately capped
  // to the small arbitrage universe so we do not recreate the Worker
  // subrequest spikes caused by the Gemini strategy path.
  const poolResponses = await Promise.all(
    ARBITRAGE_ASSETS.map(async asset => ({
      asset,
      pools: await fetchTokenPools(asset)
    }))
  );

  const poolMap = new Map<string, PoolRecord>();
  for (const response of poolResponses) {
    for (const raw of response.pools) {
      const parsed = parsePool(raw, assets);
      if (!parsed) continue;
      if (!poolMap.has(parsed.address)) poolMap.set(parsed.address, parsed);
    }
  }

  const edges: PoolEdge[] = [];
  for (const pool of poolMap.values()) addEdge(edges, pool);

  let tokenPrices: Record<string, string> = {};
  try {
    tokenPrices = await fetchTokenPrices();
    addIndicativeCurveEdges(edges, tokenPrices);
  } catch (error) {
    console.error("LST token-price enrichment failed:", error);
  }

  const wmon = ARBITRAGE_ASSETS.find(a => a.symbol === "WMON")!;
  const triangles = findTriangles(edges, wmon.address);

  const opportunities = triangles.flatMap(triangle =>
    TRADE_SIZES_MON.map(sizeMon => {
      const grossProfitMon = sizeMon * triangle.multiplier - sizeMon;
      const slippageBufferMon = sizeMon * (SLIPPAGE_BUFFER_PCT / 100);
      const netProfitMon =
        grossProfitMon - slippageBufferMon - GAS_BUFFER_MON;

      return {
        ...triangle,
        sizeMon,
        grossProfitMon,
        slippageBufferMon,
        gasBufferMon: GAS_BUFFER_MON,
        estimatedNetProfitMon: netProfitMon,
        candidate:
          triangle.grossEdgePct >= MIN_GROSS_EDGE_PCT &&
          netProfitMon > 0,
        requiresExactQuote: true,
        liveExecutable: false
      };
    })
  );

  const ranked = opportunities
    .sort((a, b) => b.estimatedNetProfitMon - a.estimatedNetProfitMon);

  return {
    generatedAt: new Date().toISOString(),
    mode: "PAPER_SIGNAL_ONLY",
    startAsset: "WMON (1:1 with native MON)",
    assets: ARBITRAGE_ASSETS,
    discoveredPools: poolMap.size,
    edges: edges.length,
    tokenPrices,
    trianglesChecked: triangles.length,
    opportunities: ranked.slice(0, 50),
    signals: ranked.filter(o => o.candidate).slice(0, 20),
    rules: {
      liveExecution: false,
      minimumLiquidityUsd: MIN_LIQUIDITY_USD,
      minimumGrossEdgePct: MIN_GROSS_EDGE_PCT,
      slippageBufferPct: SLIPPAGE_BUFFER_PCT,
      tradeSizesMon: TRADE_SIZES_MON,
      exactExecutionRequired: true,
      note:
        "This now detects triangular MON/LST/stablecoin routes such as MON→shMON→sMON→MON and cross-venue variants. Prices are discovery signals; live trading must obtain exact executable quotes and route simulation for all three legs before submitting."
    }
  };
}
