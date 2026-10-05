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

export const MIN_LIQUIDITY_USD = 5_000;
export const MIN_GROSS_EDGE_PCT = 0.15;
export const EXECUTION_BUFFER_PCT = 0.20;
export const MIN_NET_PROFIT_MON = 0.005;
export const GAS_BUFFER_MON = 0.001;
export const TRADE_SIZES_MON = [1, 5, 10];
export const MAX_EXACT_TRIANGLES = 3;
const EXECUTION_BUFFER_BPS = Math.round(EXECUTION_BUFFER_PCT * 100);
const DEXSCREENER_TOKEN_URL = "https://api.dexscreener.com/tokens/v1/monad";
const DEXSCREENER_CACHE_TTL_MS = 60_000;

export type LSTArbitrageCache = {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
};

const POOL_CACHE_TTL_MS = 5 * 60_000;
const PROVIDER_RETRY_FLOOR_MS = 60_000;
const PROVIDER_ATTEMPT_COOLDOWN_MS = 60_000;
const CACHE_KEY_PREFIX = "lst-arb:gecko";

class GeckoHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | null,
    message: string
  ) {
    super(message);
    this.name = "GeckoHttpError";
  }
}


const QUOTER_V2_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
]);

const UNISWAP_V3_POOL_ABI = parseAbi([
  "function fee() view returns (uint24)"
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

export type PoolEdge = {
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

export type ArbitrageSignal = {
  path: string[];
  sizeMon: number;
  amountInRaw: string;
  finalMon: number;
  finalQuoteRaw: string;
  protectedFinalMon: number;
  protectedFinalRaw: string;
  minFinalWmonRaw: string;
  grossProfitMon: number;
  executionBufferMon: number;
  netProfitMon: number;
  legs: Array<{
    pool: string;
    tokenIn: string;
    tokenOut: string;
    from: string;
    to: string;
    venue: string;
    dex: string;
    quoteKind: QuoteKind;
    feePct: number;
    feeBps: number;
    curveI: number | null;
    curveJ: number | null;
    amountInRaw: string;
    quoteAmountOutRaw: string;
    minAmountOutRaw: string;
  }>;
  liveExecutable: false;
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

function retryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return null;
}

async function fetchJson(url: string) {
  const r = await fetch(url, {
    headers: {
      accept: "application/json;version=20230203"
    }
  });

  if (!r.ok) {
    const retry = retryAfterMs(r.headers.get("retry-after"));
    throw new GeckoHttpError(
      r.status,
      retry,
      `HTTP ${r.status} for ${url}`
    );
  }

  return r.json() as Promise<any>;
}

async function fetchTokenPools(asset: ArbitrageAsset) {
  const url =
    `https://api.geckoterminal.com/api/v2/networks/${MONAD_NETWORK}/tokens/${asset.address}/pools?page=1&include=base_token,quote_token,dex`;
  const json = await fetchJson(url);
  return Array.isArray(json?.data) ? json.data : [];
}

async function fetchDexScreenerPairs() {
  const addresses = ARBITRAGE_ASSETS
    .map(a => a.address)
    .join(",");
  const json = await fetchJson(
    `${DEXSCREENER_TOKEN_URL}/${addresses}`
  );
  return Array.isArray(json) ? json : [];
}

function parseDexScreenerPair(
  pair: any,
  assets: Map<string, ArbitrageAsset>
): PoolRecord | null {
  const base = addr(pair?.baseToken?.address);
  const quote = addr(pair?.quoteToken?.address);
  if (!base || !quote || base === quote) return null;

  const baseAsset = assets.get(base);
  const quoteAsset = assets.get(quote);
  if (!baseAsset || !quoteAsset) return null;

  const baseToQuote = num(pair?.priceNative);
  if (!(baseToQuote > 0)) return null;

  const dex = String(pair?.dexId ?? "unknown");
  const labels = Array.isArray(pair?.labels)
    ? pair.labels.map((x: unknown) => String(x).toLowerCase())
    : [];
  const pairAddress = addr(pair?.pairAddress);
  const isV3 = dex.includes("uniswap") && labels.includes("v3");
  const quoteKind: QuoteKind =
    pairAddress === CURVE_LST_POOL.toLowerCase()
      ? "curve-lst"
      : isV3
        ? "uniswap-v3"
        : "unsupported";

  return {
    id: String(pair?.pairAddress ?? ""),
    name: `${baseAsset.symbol}/${quoteAsset.symbol} ${dex}${isV3 ? " v3" : ""}`,
    address: pairAddress,
    base,
    quote,
    baseSymbol: baseAsset.symbol,
    quoteSymbol: quoteAsset.symbol,
    baseToQuote,
    // Uniswap v3 fee is read directly from the pool contract before exact
    // quoting. DEX Screener does not expose the fee tier in this response.
    feePct: 0,
    liquidityUsd: num(pair?.liquidity?.usd),
    volume24hUsd: num(pair?.volume?.h24),
    dex,
    quoteKind
  };
}

async function getDexScreenerSnapshot(cache?: LSTArbitrageCache) {
  const key = `${CACHE_KEY_PREFIX}:dexscreener:pairs`;
  const now = Date.now();
  const cached = await readCache<any[]>(cache, key);

  if (cached && now - cached.fetchedAt < DEXSCREENER_CACHE_TTL_MS) {
    return {
      pairs: cached.data,
      provider: {
        name: "DEX Screener",
        requestsThisScan: 0,
        cached: true,
        fetchedAt: cached.fetchedAt,
        cacheTtlMs: DEXSCREENER_CACHE_TTL_MS
      }
    };
  }

  try {
    const pairs = await fetchDexScreenerPairs();
    await writeCache(cache, key, pairs, now);
    return {
      pairs,
      provider: {
        name: "DEX Screener",
        requestsThisScan: 1,
        cached: false,
        fetchedAt: now,
        cacheTtlMs: DEXSCREENER_CACHE_TTL_MS
      }
    };
  } catch (error) {
    // A stale snapshot is preferable to turning the arbitrage endpoint red.
    // Exact quotes still come from Monad RPC, so stale market topology cannot
    // become a submitted transaction.
    if (cached) {
      return {
        pairs: cached.data,
        provider: {
          name: "DEX Screener",
          requestsThisScan: 1,
          cached: true,
          stale: true,
          fetchedAt: cached.fetchedAt,
          cacheTtlMs: DEXSCREENER_CACHE_TTL_MS,
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
    throw error;
  }
}

type CacheEntry<T> = {
  fetchedAt: number;
  data: T;
};

async function readCache<T>(
  cache: LSTArbitrageCache | undefined,
  key: string
): Promise<CacheEntry<T> | null> {
  if (!cache) return null;
  try {
    const raw = await cache.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.fetchedAt === "number" &&
      "data" in parsed
    ) {
      return parsed as CacheEntry<T>;
    }
  } catch {
    // A broken cache entry must never break the scanner.
  }
  return null;
}

async function writeCache<T>(
  cache: LSTArbitrageCache | undefined,
  key: string,
  data: T,
  fetchedAt = Date.now()
) {
  if (!cache) return;
  try {
    await cache.put(
      key,
      JSON.stringify({ fetchedAt, data })
    );
  } catch {
    // Cache persistence is best-effort.
  }
}

async function providerBlockedUntil(cache: LSTArbitrageCache | undefined) {
  if (!cache) return 0;
  try {
    const raw = await cache.get(`${CACHE_KEY_PREFIX}:blocked-until`);
    const value = Number(raw ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

async function setProviderBlockedUntil(
  cache: LSTArbitrageCache | undefined,
  until: number
) {
  if (!cache) return;
  try {
    await cache.put(
      `${CACHE_KEY_PREFIX}:blocked-until`,
      String(until)
    );
  } catch {
    // Best-effort only.
  }
}

async function collectPoolPayloads(cache?: LSTArbitrageCache) {
  // WMON is deliberately excluded: every WMON/LST pool is discoverable
  // from the LST side, which saves one provider call per refresh window.
  const targets = ARBITRAGE_ASSETS.filter(a => a.symbol !== "WMON");
  const entries = new Map<string, CacheEntry<any[]> | null>();

  await Promise.all(
    targets.map(async asset => {
      entries.set(
        asset.address.toLowerCase(),
        await readCache<any[]>(
          cache,
          `${CACHE_KEY_PREFIX}:pools:${asset.address.toLowerCase()}`
        )
      );
    })
  );

  const now = Date.now();
  const stale = targets.filter(asset => {
    const entry = entries.get(asset.address.toLowerCase());
    return !entry || now - entry.fetchedAt >= POOL_CACHE_TTL_MS;
  });

  const blockedUntil = await providerBlockedUntil(cache);
  let refreshedAsset: string | null = null;
  let rateLimited = false;
  let requestCount = 0;

  if (stale.length > 0 && now >= blockedUntil) {
    const candidates = [];
    for (const asset of stale) {
      const entry = entries.get(asset.address.toLowerCase());
      let lastAttemptAt = 0;
      if (cache) {
        try {
          lastAttemptAt = Number(
            await cache.get(
              `${CACHE_KEY_PREFIX}:attempt:${asset.address.toLowerCase()}`
            ) ?? 0
          );
        } catch {
          lastAttemptAt = 0;
        }
      }
      candidates.push({
        asset,
        fetchedAt: entry?.fetchedAt ?? 0,
        lastAttemptAt: Number.isFinite(lastAttemptAt) ? lastAttemptAt : 0
      });
    }

    const eligible = candidates.filter(
      x => now - x.lastAttemptAt >= PROVIDER_ATTEMPT_COOLDOWN_MS
    );

    if (eligible.length > 0) {
      eligible.sort((a, b) =>
        (a.fetchedAt - b.fetchedAt) ||
        (a.lastAttemptAt - b.lastAttemptAt)
      );

      const target = eligible[0].asset;

      if (cache) {
        try {
          await cache.put(
            `${CACHE_KEY_PREFIX}:attempt:${target.address.toLowerCase()}`,
            String(now)
          );
        } catch {
          // Best-effort only.
        }
      }

      try {
        const pools = await fetchTokenPools(target);
        await writeCache(
          cache,
          `${CACHE_KEY_PREFIX}:pools:${target.address.toLowerCase()}`,
          pools,
          now
        );
        entries.set(target.address.toLowerCase(), {
          fetchedAt: now,
          data: pools
        });
        refreshedAsset = target.symbol;
        requestCount = 1;
      } catch (error) {
        requestCount = 1;

        if (error instanceof GeckoHttpError && error.status === 429) {
          rateLimited = true;
          const delay = Math.max(
            PROVIDER_RETRY_FLOOR_MS,
            error.retryAfterMs ?? PROVIDER_RETRY_FLOOR_MS
          );
          await setProviderBlockedUntil(cache, now + delay);
        }
      }
    }
  }

  const payloads = targets.map(asset =>
    entries.get(asset.address.toLowerCase())?.data ?? []
  );

  const cachedAssets = targets.filter(asset =>
    Boolean(entries.get(asset.address.toLowerCase()))
  ).map(asset => asset.symbol);

  const staleAssets = targets.filter(asset => {
    const entry = entries.get(asset.address.toLowerCase());
    return !entry || now - entry.fetchedAt >= POOL_CACHE_TTL_MS;
  }).map(asset => asset.symbol);

  return {
    payloads,
    provider: {
      name: "GeckoTerminal",
      requestsThisScan: requestCount,
      refreshedAsset,
      rateLimited,
      blockedUntil: Math.max(blockedUntil, await providerBlockedUntil(cache)),
      cachedAssets,
      staleAssets,
      poolCacheTtlMs: POOL_CACHE_TTL_MS
    }
  };
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

function addKnownCurveEdges(edges: PoolEdge[]) {
  const symbols = ["WMON", "shMON", "sMON", "gMON"];
  const bySymbol = new Map(ARBITRAGE_ASSETS.map(a => [a.symbol, a]));

  // Known 4-asset Curve pool on Monad. Exact quotes are still required before
  // a route can become a signal, so these edges are only route-discovery seeds.
  for (const fromSymbol of symbols) {
    for (const toSymbol of symbols) {
      if (fromSymbol === toSymbol) continue;
      const from = bySymbol.get(fromSymbol);
      const to = bySymbol.get(toSymbol);
      if (!from || !to) continue;

      edges.push({
        pool: CURVE_LST_POOL,
        venue: "Curve LST multi-pool",
        dex: "curve",
        from: from.address,
        to: to.address,
        fromSymbol,
        toSymbol,
        rate: 1,
        feePct: 0,
        liquidityUsd: 900_000,
        volume24hUsd: 0,
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
    let feeBps = Math.round(edge.feePct * 10_000);

    if (!(feeBps > 0)) {
      const poolFee = await client.readContract({
        address: edge.pool as Address,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "fee"
      });
      feeBps = Number(poolFee);
    }

    if (!(feeBps > 0 && feeBps <= 1_000_000)) return null;

    const result = await client.readContract({
      address: UNISWAP_V3_QUOTER_V2,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn: edge.from as Address,
        tokenOut: edge.to as Address,
        amountIn,
        fee: feeBps,
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
  const safetyNumerator = 10_000n - BigInt(EXECUTION_BUFFER_BPS);
  const safetyDenominator = 10_000n;

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

      const minAmountOut =
        quote.amountOut * safetyNumerator / safetyDenominator;

      const curveIndex: Record<string, number> = {
        "0x3bd359c1119da7da1d913d1c4d2b7c461115433a": 0,
        "0x1b68626dca36c7fe922fd2d55e4f631d962de19c": 1,
        "0xa3227c5969757783154c60bf0bc1944180ed81b9": 2,
        "0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081": 3
      };

      exactLegs.push({
        pool: leg.pool,
        tokenIn: leg.from,
        tokenOut: leg.to,
        from: leg.fromSymbol,
        to: leg.toSymbol,
        venue: leg.venue,
        dex: leg.dex,
        quoteKind: leg.quoteKind,
        feePct: leg.feePct,
        feeBps: Math.round(leg.feePct * 10_000),
        curveI: curveIndex[leg.from] ?? null,
        curveJ: curveIndex[leg.to] ?? null,
        amountInRaw: amount.toString(),
        quoteAmountOutRaw: quote.amountOut.toString(),
        minAmountOutRaw: minAmountOut.toString(),
        amountOutHuman: formatUnits(
          quote.amountOut,
          ARBITRAGE_ASSETS.find(a => a.address.toLowerCase() === leg.to)?.decimals ?? 18
        ),
        gasEstimate: quote.gasEstimate?.toString() ?? null
      });

      amount = quote.amountOut;
    }

    const finalQuoteRaw = amount;
    const finalMon = Number(formatUnits(finalQuoteRaw, 18));
    const grossProfitMon = finalMon - sizeMon;

    // This is an execution-risk haircut, not a claim about the AMM's exact
    // worst-case fill. The real transaction will additionally enforce each
    // leg's minAmountOut and the final WMON threshold atomically.
    let protectedFinalRaw = finalQuoteRaw;
    for (let i = 0; i < triangle.legs.length; i++) {
      protectedFinalRaw =
        protectedFinalRaw * safetyNumerator / safetyDenominator;
    }

    const protectedFinalMon = Number(formatUnits(protectedFinalRaw, 18));
    const executionBufferMon = Math.max(0, finalMon - protectedFinalMon);
    const netProfitMon =
      protectedFinalMon - sizeMon - GAS_BUFFER_MON;

    const minFinalWmonRaw = parseUnits(
      (sizeMon + MIN_NET_PROFIT_MON + GAS_BUFFER_MON).toFixed(18),
      18
    );

    return {
      sizeMon,
      ok: true,
      finalMon,
      finalQuoteRaw: finalQuoteRaw.toString(),
      protectedFinalMon,
      protectedFinalRaw: protectedFinalRaw.toString(),
      grossProfitMon,
      executionBufferMon,
      gasBufferMon: GAS_BUFFER_MON,
      netProfitMon,
      minFinalWmonRaw: minFinalWmonRaw.toString(),
      candidate:
        protectedFinalRaw >= minFinalWmonRaw &&
        netProfitMon >= MIN_NET_PROFIT_MON,
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

export async function scanLSTArbitrage(
  rpcUrl: string,
  cache?: LSTArbitrageCache
) {
  const assets = assetMap();

  let pools: PoolRecord[] = [];
  let provider: any = null;

  try {
    const dexSnapshot = await getDexScreenerSnapshot(cache);
    pools = dexSnapshot.pairs
      .map((pair: any) => parseDexScreenerPair(pair, assets))
      .filter((pool: PoolRecord | null): pool is PoolRecord => Boolean(pool));
    provider = dexSnapshot.provider;
  } catch (error) {
    // GeckoTerminal remains as a degraded fallback. Its requests are still
    // persisted and rate-limited by the Durable Object cache.
    const collection = await collectPoolPayloads(cache);
    pools = collection.payloads
      .flat()
      .map((record: any) => parsePool(record, assets))
      .filter((pool: PoolRecord | null): pool is PoolRecord => Boolean(pool));
    provider = {
      ...collection.provider,
      fallbackFrom: "DEX Screener",
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const edges: PoolEdge[] = [];
  for (const pool of pools) addEdge(edges, pool);

  // Keep the known multi-asset Curve pool available even when external market
  // data is degraded. It is always quoted on-chain before being considered.
  addKnownCurveEdges(edges);

  const wmon = ARBITRAGE_ASSETS.find(a => a.symbol === "WMON")!;

  // A useful triangular opportunity needs at least two distinct pools/venues.
  const triangles = findTriangles(edges, wmon.address.toLowerCase())
    .filter(t =>
      t.exactQuoteSupported &&
      new Set(t.legs.map(leg => leg.pool.toLowerCase())).size >= 2
    )
    .slice(0, MAX_EXACT_TRIANGLES);

  const client = createClient(rpcUrl);
  const exactResults = await Promise.all(
    triangles.map(async route => {
      const exactQuotes = await Promise.all(
        TRADE_SIZES_MON.map(size => simulateTriangle(client, route, size))
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
    triangleCount: triangles.length,
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
    provider,
    execution: {
      live: false,
      transactionsSubmitted: 0,
      reason: "Arbitrage execution is disabled; this endpoint only discovers and simulates routes."
    }
  };
}
