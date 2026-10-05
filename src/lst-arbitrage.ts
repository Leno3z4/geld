import {
  createPublicClient,
  http,
  parseAbi,
  formatUnits,
  parseUnits,
  type Address
} from "viem";

const MONAD_NETWORK = "monad";
const MONAD_CHAIN = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } }
} as const;

const UNISWAP_V3_QUOTER_V2 =
  "0x661e93cca42afacb172121ef892830ca3b70f08d" as Address;

const CURVE_LST_POOL =
  "0x74d80ee400d3026fdd2520265cc98300710b25d4" as Address;

const MIN_LIQUIDITY_USD = 5_000;
const MIN_GROSS_EDGE_PCT = 0.15;
const EXECUTION_BUFFER_PCT = 0.20;
const MIN_NET_PROFIT_MON = 0.005;
const GAS_BUFFER_MON = 0.001;
const TRADE_SIZES_MON = [1, 5, 10];
const MAX_EXACT_TRIANGLES = 3;

const QUOTER_V2_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
]);

const CURVE_POOL_ABI = parseAbi([
  "function get_dy(int128 i,int128 j,uint256 dx) view returns (uint256)"
]);

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

type QuoteKind = "uniswap-v3" | "curve-lst" | "unsupported";

type PoolEdge = {
  pool: string;
  venue: string;
  dex: string;
  from: string;
  to: string;
  fromSymbol: string;
  toSymbol: string;
  rate: number;
  feePct: number;
  liquidityUsd: number;
  volume24hUsd: number;
  quoteKind: QuoteKind;
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
  quoteKind: QuoteKind;
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

function inferV3FeePct(name: string, fallback: number) {
  if (fallback > 0) return fallback;
  const match = name.match(/(0\.01|0\.02|0\.03|0\.04|0\.05|0\.1|0\.2|0\.3|1(?:\.0)?)%/i);
  return match ? Number(match[1]) : 0;
}

function classifyQuoteKind(address: string, dex: string) {
  const d = dex.toLowerCase();
  if (address.toLowerCase() === CURVE_LST_POOL.toLowerCase()) return "curve-lst" as const;
  if (d.includes("uniswap") && d.includes("v3")) return "uniswap-v3" as const;
  return "unsupported" as const;
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

  const name = String(a.name ?? `${baseAsset.symbol}/${quoteAsset.symbol}`);
  const feePct = inferV3FeePct(
    name,
    num(a.pool_fee_percentage ?? a.fee_percentage ?? a.pool_fee)
  );
  const dex = String(record?.relationships?.dex?.data?.id ?? "unknown");

  return {
    id: String(record?.id ?? ""),
    name,
    address: String(a.address ?? record?.id ?? ""),
    base,
    quote,
    baseSymbol: baseAsset.symbol,
    quoteSymbol: quoteAsset.symbol,
    baseToQuote,
    feePct,
    liquidityUsd: num(a.reserve_in_usd),
    volume24hUsd: num(a.volume_usd?.h24),
    dex,
    quoteKind: classifyQuoteKind(String(a.address ?? record?.id ?? ""), dex)
  };
}

function addEdge(edges: PoolEdge[], pool: PoolRecord) {
  if (pool.liquidityUsd < MIN_LIQUIDITY_USD) return;

  const feeMultiplier = Math.max(0, 1 - pool.feePct / 100);

  edges.push({
    pool: pool.address,
    venue: pool.name,
    dex: pool.dex,
    from: pool.base,
    to: pool.quote,
    fromSymbol: pool.baseSymbol,
    toSymbol: pool.quoteSymbol,
    rate: pool.baseToQuote * feeMultiplier,
    feePct: pool.feePct,
    liquidityUsd: pool.liquidityUsd,
    volume24hUsd: pool.volume24hUsd,
    quoteKind: pool.quoteKind
  });

  edges.push({
    pool: pool.address,
    venue: pool.name,
    dex: pool.dex,
    from: pool.quote,
    to: pool.base,
    fromSymbol: pool.quoteSymbol,
    toSymbol: pool.baseSymbol,
    rate: (1 / pool.baseToQuote) * feeMultiplier,
    feePct: pool.feePct,
    liquidityUsd: pool.liquidityUsd,
    volume24hUsd: pool.volume24hUsd,
    quoteKind: pool.quoteKind
  });
}

function addIndicativeCurveEdges(
  edges: PoolEdge[],
  tokenPrices: Record<string, string>
) {
  const symbols = ["WMON", "shMON", "sMON", "gMON"];
  const bySymbol = new Map(ARBITRAGE_ASSETS.map(a => [a.symbol, a]));

  for (const fromSymbol of symbols) {
    for (const toSymbol of symbols) {
      if (fromSymbol === toSymbol) continue;
      const from = bySymbol.get(fromSymbol);
      const to = bySymbol.get(toSymbol);
      if (!from || !to) continue;

      const fromUsd = num(tokenPrices[from.address]);
      const toUsd = num(tokenPrices[to.address]);
      if (!(fromUsd > 0) || !(toUsd > 0)) continue;

      edges.push({
        pool: CURVE_LST_POOL,
        venue: "Curve LST multi-pool",
        dex: "curve",
        from: from.address,
        to: to.address,
        fromSymbol,
        toSymbol,
        rate: fromUsd / toUsd,
        feePct: 0,
        liquidityUsd: 919_000,
        volume24hUsd: 173_000,
        quoteKind: "curve-lst"
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
          ...pools.slice().sort()
        ].join(":");

        if (seen.has(key)) continue;
        seen.add(key);

        const multiplier = first.rate * second.rate * third.rate;

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
          grossEdgePct: (multiplier - 1) * 100,
          exactQuoteSupported: [first, second, third].every(
            leg => leg.quoteKind !== "unsupported"
          )
        });
      }
    }
  }

  return results.sort((a, b) => b.grossEdgePct - a.grossEdgePct);
}

function createClient(rpcUrl: string) {
  return createPublicClient({
    chain: {
      ...MONAD_CHAIN,
      rpcUrls: { default: { http: [rpcUrl] } }
    },
    transport: http(rpcUrl, { timeout: 6_000 })
  });
}

async function quoteExactEdge(
  client: ReturnType<typeof createClient>,
  edge: PoolEdge,
  amountIn: bigint
): Promise<{ amountOut: bigint; gasEstimate?: bigint } | null> {
  if (edge.quoteKind === "curve-lst") {
    const indexByAddress: Record<string, number> = {
      "0x3bd359c1119da7da1d913d1c4d2b7c461115433a": 0,
      "0x1b68626dca36c7fe922fd2d55e4f631d962de19c": 1,
      "0xa3227c5969757783154c60bf0bc1944180ed81b9": 2,
      "0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081": 3
    };

    const i = indexByAddress[edge.from];
    const j = indexByAddress[edge.to];
    if (i === undefined || j === undefined || i === j) return null;

    const amountOut = await client.readContract({
      address: CURVE_LST_POOL,
      abi: CURVE_POOL_ABI,
      functionName: "get_dy",
      args: [BigInt(i), BigInt(j), amountIn]
    });

    return { amountOut };
  }

  if (edge.quoteKind === "uniswap-v3") {
    const fee = Math.round(edge.feePct * 10_000);
    if (!(fee > 0 && fee <= 1_000_000)) return null;

    const result = await client.readContract({
      address: UNISWAP_V3_QUOTER_V2,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn: edge.from as Address,
        tokenOut: edge.to as Address,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n
      }]
    });

    const values = result as readonly [bigint, bigint, number, bigint];
    return {
      amountOut: values[0],
      gasEstimate: values[3]
    };
  }

  return null;
}

async function simulateTriangle(
  client: ReturnType<typeof createClient>,
  triangle: ReturnType<typeof findTriangles>[number],
  sizeMon: number
) {
  let amount = parseUnits(String(sizeMon), 18);
  const exactLegs = [];

  try {
    for (const leg of triangle.legs) {
      const quote = await quoteExactEdge(client, leg, amount);
      if (!quote || quote.amountOut <= 0n) {
        return {
          sizeMon,
          ok: false,
          error: `No exact quote for ${leg.fromSymbol}->${leg.toSymbol} at ${leg.venue}`
        };
      }

      exactLegs.push({
        from: leg.fromSymbol,
        to: leg.toSymbol,
        venue: leg.venue,
        quoteKind: leg.quoteKind,
        amountInRaw: amount.toString(),
        amountOutRaw: quote.amountOut.toString(),
        amountOutHuman: formatUnits(
          quote.amountOut,
          ARBITRAGE_ASSETS.find(a => a.address.toLowerCase() === leg.to)?.decimals ?? 18
        ),
        gasEstimate: quote.gasEstimate?.toString() ?? null
      });

      amount = quote.amountOut;
    }

    const finalMon = Number(formatUnits(amount, 18));
    const grossProfitMon = finalMon - sizeMon;
    const executionBufferMon = sizeMon * (EXECUTION_BUFFER_PCT / 100);
    const netProfitMon =
      grossProfitMon - executionBufferMon - GAS_BUFFER_MON;

    return {
      sizeMon,
      ok: true,
      finalMon,
      grossProfitMon,
      executionBufferMon,
      gasBufferMon: GAS_BUFFER_MON,
      netProfitMon,
      candidate: netProfitMon >= MIN_NET_PROFIT_MON,
      exactLegs
    };
  } catch (error) {
    return {
      sizeMon,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function scanLSTArbitrage(rpcUrl = "https://rpc.monad.xyz") {
  const assets = assetMap();

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

  const exactCandidates = triangles
    .filter(t => t.exactQuoteSupported)
    .filter(t => t.grossEdgePct >= MIN_GROSS_EDGE_PCT)
    .slice(0, MAX_EXACT_TRIANGLES);

  const client = createClient(rpcUrl);
  const exactResults = [];
  for (const triangle of exactCandidates) {
    const sizes = [];
    for (const sizeMon of TRADE_SIZES_MON) {
      sizes.push(await simulateTriangle(client, triangle, sizeMon));
    }
    exactResults.push({
      ...triangle,
      exactQuotes: sizes,
      exactSignal: sizes.some(s => s.ok && s.candidate)
    });
  }

  const signals = exactResults.flatMap(route =>
    route.exactQuotes
      .filter(q => q.ok && q.candidate)
      .map(q => ({
        path: route.path,
        sizeMon: q.sizeMon,
        finalMon: q.finalMon,
        netProfitMon: q.netProfitMon,
        legs: route.legs.map(leg => ({
          from: leg.fromSymbol,
          to: leg.toSymbol,
          venue: leg.venue,
          quoteKind: leg.quoteKind
        })),
        liveExecutable: false
      }))
  );

  return {
    generatedAt: new Date().toISOString(),
    mode: "PAPER_EXACT_QUOTE",
    startAsset: "WMON (1:1 with native MON)",
    assets: ARBITRAGE_ASSETS,
    discoveredPools: poolMap.size,
    edges: edges.length,
    trianglesChecked: triangles.length,
    exactTrianglesChecked: exactResults.length,
    opportunities: exactResults,
    signals,
    rules: {
      liveExecution: false,
      minimumLiquidityUsd: MIN_LIQUIDITY_USD,
      minimumGrossEdgePct: MIN_GROSS_EDGE_PCT,
      executionBufferPct: EXECUTION_BUFFER_PCT,
      minimumNetProfitMon: MIN_NET_PROFIT_MON,
      gasBufferMon: GAS_BUFFER_MON,
      tradeSizesMon: TRADE_SIZES_MON,
      maxExactTriangles: MAX_EXACT_TRIANGLES,
      note:
        "This detects cyclic MON/LST/stablecoin routes. Spot data ranks routes; exact on-chain quotes then simulate each leg using the previous leg's actual output. Live execution still requires an atomic executor, approvals, pre-trade balance checks, and final min-output protection."
    }
  };
}
