const KNOWN_UNISWAP_POOLS: PoolRecord[] = [
  {
    id: "0x1f86a9f2441cac9b942cfb5445530cdbb28717ed",
    name: "shMON/WMON Uniswap v3",
    address: "0x1f86a9f2441cac9b942cfb5445530cdbb28717ed",
    base: "0x1b68626dca36c7fe922fd2d55e4f631d962de19c",
    quote: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
    baseSymbol: "shMON",
    quoteSymbol: "WMON",
    baseToQuote: 1.6293,
    feePct: 0,
    liquidityUsd: 215263.28,
    volume24hUsd: 1579.06,
    dex: "uniswap",
    quoteKind: "uniswap-v3"
  },
  {
    id: "0x36a81ebd73b86b485a14911ea16f3d7c96cc00b0",
    name: "sMON/WMON Uniswap v3",
    address: "0x36a81ebd73b86b485a14911ea16f3d7c96cc00b0",
    base: "0xa3227c5969757783154c60bf0bc1944180ed81b9",
    quote: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
    baseSymbol: "sMON",
    quoteSymbol: "WMON",
    baseToQuote: 1.1126,
    feePct: 0,
    liquidityUsd: 7685.69,
    volume24hUsd: 209.26,
    dex: "uniswap",
    quoteKind: "uniswap-v3"
  },
  {
    id: "0xb80d7a8f5331a907e34cd73f575c784b43e5acb5",
    name: "gMON/WMON Uniswap v3",
    address: "0xb80d7a8f5331a907e34cd73f575c784b43e5acb5",
    base: "0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081",
    quote: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
    baseSymbol: "gMON",
    quoteSymbol: "WMON",
    baseToQuote: 1.1006,
    feePct: 0,
    liquidityUsd: 90344.63,
    volume24hUsd: 850.15,
    dex: "uniswap",
    quoteKind: "uniswap-v3"
  }
];
// LST arbitrage scanner: primary market discovery via DEX Screener, GeckoTerminal fallback.
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
export const MAX_EXACT_TRIANGLES = 4;
const EXECUTION_BUFFER_BPS = Math.round(EXECUTION_BUFFER_PCT * 100);
const DEXPAPRIKA_POOLS_URL = "https://api.dexpaprika.com/networks/monad/pools/search?order_by=volume_usd_24h&sort=desc&limit=250";
const DEXPAPRIKA_CACHE_TTL_MS = 5 * 60_000;
const KURU_MARKET_ABI = parseAbi([
  "function getMarketParams() view returns (uint256 pricePrecision,uint256 sizePrecision,address baseAssetAddress,uint256 baseAssetDecimals,address quoteAssetAddress,uint256 quoteAssetDecimals,uint256 tickSize,uint256 minSize,uint256 maxSize,int256 takerFeeBps,int256 makerFeeBps)",
  "function placeAndExecuteMarketSell(uint256 size,uint256 minAmountOut,bool isMargin,bool fillOrKill) returns (uint256)",
  "function placeAndExecuteMarketBuy(uint256 size,uint256 minAmountOut,bool isMargin,bool fillOrKill) returns (uint256)"
]);
const V2_PAIR_ABI = parseAbi([
  "function token0() view returns (address)",
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)"
]);

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

type QuoteKind = "uniswap-v3" | "uniswap-v2" | "pancake-v3" | "pancake-v2" | "curve-lst" | "kuru" | "unsupported";

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

function normalizeAssetAddress(value: unknown) {
  const a = addr(value);
  // Kuru represents native MON as address(0); treat it as WMON for route
  // discovery, while the Kuru quote adapter handles the market's native side.
  if (a === "0x0000000000000000000000000000000000000000" ||
      a === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
    return "0x3bd359c1119da7da1d913d1c4d2b7c461115433a";
  }
  return a;
}


async function discoverDexPaprikaPools(cache?: LSTArbitrageCache) {
  const key = "lst-arb:dexpaprika:pools";
  const now = Date.now();
  const cached = await readCache<any[]>(cache, key);
  if (cached && now - cached.fetchedAt < DEXPAPRIKA_CACHE_TTL_MS) {
    return { pools: cached.data, provider: { name: "DexPaprika", requestsThisScan: 0, cached: true, fetchedAt: cached.fetchedAt } };
  }
  try {
    const response = await fetch(DEXPAPRIKA_POOLS_URL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`DexPaprika HTTP ${response.status}`);
    const json = await response.json() as any;
    const pools = Array.isArray(json?.results) ? json.results : [];
    await writeCache(cache, key, pools, now);
    return { pools, provider: { name: "DexPaprika", requestsThisScan: 1, cached: false, fetchedAt: now } };
  } catch (error) {
    if (cached) return {
      pools: cached.data,
      provider: { name: "DexPaprika", requestsThisScan: 1, cached: true, stale: true, fetchedAt: cached.fetchedAt, error: error instanceof Error ? error.message : String(error) }
    };
    return { pools: [], provider: { name: "DexPaprika", requestsThisScan: 1, cached: false, error: error instanceof Error ? error.message : String(error) } };
  }
}

function parseDexPaprikaPool(record: any, assets: Map<string, ArbitrageAsset>): PoolRecord | null {
  const tokens = Array.isArray(record?.tokens) ? record.tokens : [];
  if (tokens.length !== 2) return null;
  const base = normalizeAssetAddress(tokens[0]?.id);
  const quote = normalizeAssetAddress(tokens[1]?.id);
  if (!base || !quote || base === quote) return null;
  const baseAsset = assets.get(base);
  const quoteAsset = assets.get(quote);
  if (!baseAsset || !quoteAsset) return null;
  const dexId = String(record?.dex_id ?? "").toLowerCase();
  const dexName = String(record?.dex_name ?? record?.dex_id ?? "unknown");
  const poolAddress = addr(record?.id);
  if (!poolAddress) return null;

  let quoteKind: QuoteKind = "unsupported";
  if (poolAddress === CURVE_LST_POOL.toLowerCase()) quoteKind = "curve-lst";
  else if (dexId === "uniswap_v3") quoteKind = "uniswap-v3";
  else if (dexId === "uniswap_v2") quoteKind = "uniswap-v2";
  else if (dexId === "pancakeswap_v3" || dexId === "pancake_v3") quoteKind = "pancake-v3";
  else if (dexId === "pancakeswap_v2" || dexId === "pancake_v2") quoteKind = "pancake-v2";
  else if (dexId === "kuru" || dexName.toLowerCase().includes("kuru")) quoteKind = "kuru";

  return {
    id: poolAddress,
    name: `${baseAsset.symbol}/${quoteAsset.symbol} ${dexName}`,
    address: poolAddress,
    base,
    quote,
    baseSymbol: baseAsset.symbol,
    quoteSymbol: quoteAsset.symbol,
    baseToQuote: 1,
    feePct: num(record?.fee) / 100,
    liquidityUsd: num(record?.liquidity_usd),
    volume24hUsd: num(record?.volume_usd_24h),
    dex: dexId || dexName,
    quoteKind
  };
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
  if (d.includes("uniswap") && d.includes("v2")) return "uniswap-v2" as const;
  if (d.includes("pancake") && d.includes("v3")) return "pancake-v3" as const;
  if (d.includes("pancake") && d.includes("v2")) return "pancake-v2" as const;
  if (d.includes("kuru")) return "kuru" as const;
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
  amountIn: bigint,
  kuruParamsCache: Map<string, any>
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
    const amountOut = await client.readContract({ address: CURVE_LST_POOL, abi: CURVE_POOL_ABI, functionName: "get_dy", args: [BigInt(i), BigInt(j), amountIn] });
    return { amountOut };
  }

  if (edge.quoteKind === "uniswap-v3" || edge.quoteKind === "pancake-v3") {
    let feeBps = Math.round(edge.feePct * 10_000);
    if (!(feeBps > 0)) {
      const poolFee = await client.readContract({ address: edge.pool as Address, abi: UNISWAP_V3_POOL_ABI, functionName: "fee" });
      feeBps = Number(poolFee);
    }
    if (!(feeBps > 0 && feeBps <= 1_000_000)) return null;
    const result = await client.readContract({
      address: UNISWAP_V3_QUOTER_V2,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: edge.from as Address, tokenOut: edge.to as Address, amountIn, fee: feeBps, sqrtPriceLimitX96: 0n }]
    });
    const values = result as readonly [bigint, bigint, number, bigint];
    return { amountOut: values[0], gasEstimate: values[3] };
  }

  if (edge.quoteKind === "uniswap-v2" || edge.quoteKind === "pancake-v2") {
    const token0 = await client.readContract({ address: edge.pool as Address, abi: V2_PAIR_ABI, functionName: "token0" });
    const reserves = await client.readContract({ address: edge.pool as Address, abi: V2_PAIR_ABI, functionName: "getReserves" });
    const [reserve0, reserve1] = reserves as readonly [bigint, bigint, number];
    const [reserveIn, reserveOut] = edge.from.toLowerCase() === String(token0).toLowerCase() ? [reserve0, reserve1] : [reserve1, reserve0];
    if (reserveIn <= 0n || reserveOut <= 0n) return null;
    const feeBps = edge.quoteKind === "pancake-v2" ? 25n : 30n;
    const amountInWithFee = amountIn * (10_000n - feeBps);
    const amountOut = amountInWithFee * reserveOut / (reserveIn * 10_000n + amountInWithFee);
    return amountOut > 0n ? { amountOut } : null;
  }

  if (edge.quoteKind === "kuru") {
    let params = kuruParamsCache.get(edge.pool.toLowerCase());
    if (!params) {
      params = await client.readContract({ address: edge.pool as Address, abi: KURU_MARKET_ABI, functionName: "getMarketParams" });
      kuruParamsCache.set(edge.pool.toLowerCase(), params);
    }
    const p = params as readonly [bigint,bigint,Address,bigint,Address,bigint,bigint,bigint,bigint,bigint,bigint];
    const base = normalizeAssetAddress(p[2]);
    const quote = normalizeAssetAddress(p[4]);
    const baseDecimals = Number(p[3]);
    const quoteDecimals = Number(p[5]);
    const sizePrecisionDecimals = Math.max(0, String(p[1]).length - 1);
    const pricePrecisionDecimals = Math.max(0, String(p[0]).length - 1);

    if (edge.from.toLowerCase() === base && edge.to.toLowerCase() === quote) {
      const sizeHuman = Number(formatUnits(amountIn, baseDecimals));
      const size = parseUnits(sizeHuman.toFixed(sizePrecisionDecimals), sizePrecisionDecimals);
      const out = await client.readContract({ address: edge.pool as Address, abi: KURU_MARKET_ABI, functionName: "placeAndExecuteMarketSell", args: [size, 0n, false, true] });
      return { amountOut: BigInt(out as bigint) };
    }
    if (edge.from.toLowerCase() === quote && edge.to.toLowerCase() === base) {
      const quoteHuman = Number(formatUnits(amountIn, quoteDecimals));
      const size = parseUnits(quoteHuman.toFixed(pricePrecisionDecimals), pricePrecisionDecimals);
      const out = await client.readContract({ address: edge.pool as Address, abi: KURU_MARKET_ABI, functionName: "placeAndExecuteMarketBuy", args: [size, 0n, false, true] });
      return { amountOut: BigInt(out as bigint) };
    }
  }
  return null;
}

async function simulateTriangle(
  client: ReturnType<typeof createClient>,
  triangle: ReturnType<typeof findTriangles>[number],
  sizeMon: number,
  kuruParamsCache: Map<string, any>
) {
  let amount = parseUnits(String(sizeMon), 18);
  const exactLegs = [];
  const safetyNumerator = 10_000n - BigInt(EXECUTION_BUFFER_BPS);
  const safetyDenominator = 10_000n;

  try {
    for (const leg of triangle.legs) {
      const quote = await quoteExactEdge(client, leg, amount, kuruParamsCache);
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
  const discovery = await discoverDexPaprikaPools(cache);
  const discoveredPools = discovery.pools
    .map((record: any) => parseDexPaprikaPool(record, assets))
    .filter((pool: PoolRecord | null): pool is PoolRecord => Boolean(pool) && pool.liquidityUsd >= MIN_LIQUIDITY_USD);

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
    .sort((a, b) => (b.distinctDexes - a.distinctDexes) || (b.distinctPools - a.distinctPools) || (b.liquidityScore - a.liquidityScore) || (b.volumeScore - a.volumeScore));

  const triangles = allRoutes.slice(0, MAX_EXACT_TRIANGLES);
  const client = createClient(rpcUrl);
  const kuruParamsCache = new Map<string, any>();

  const exactResults = await Promise.all(triangles.map(async route => {
    const exactQuotes = await Promise.all(TRADE_SIZES_MON.map(size => simulateTriangle(client, route, size, kuruParamsCache)));
    return { ...route, exactQuotes };
  }));

  const signals: ArbitrageSignal[] = [];
  for (const route of exactResults) {
    for (const q of route.exactQuotes) {
      if (q.ok !== true || q.candidate !== true) continue;
      signals.push({
        path: route.path, sizeMon: q.sizeMon, amountInRaw: parseUnits(String(q.sizeMon), 18).toString(),
        finalMon: q.finalMon, finalQuoteRaw: q.finalQuoteRaw, protectedFinalMon: q.protectedFinalMon,
        protectedFinalRaw: q.protectedFinalRaw, minFinalWmonRaw: q.minFinalWmonRaw, grossProfitMon: q.grossProfitMon,
        executionBufferMon: q.executionBufferMon, netProfitMon: q.netProfitMon,
        legs: q.exactLegs.map(leg => ({
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
    mode: "PAPER_SIGNAL_ONLY" as const, generatedAt: new Date().toISOString(), rpcUrl, assets: ARBITRAGE_ASSETS,
    poolCount: pools.length, edgeCount: edges.length, triangleCount: allRoutes.length, routes: exactResults,
    signals, topSignal: signals[0] ?? null,
    thresholds: {
      minimumLiquidityUsd: MIN_LIQUIDITY_USD, minimumGrossEdgePct: MIN_GROSS_EDGE_PCT,
      executionBufferPct: EXECUTION_BUFFER_PCT, minimumNetProfitMon: MIN_NET_PROFIT_MON,
      gasBufferMon: GAS_BUFFER_MON, tradeSizesMon: TRADE_SIZES_MON
    },
    provider: {
      name: "DexPaprika + on-chain known pools", requestsThisScan: discovery.provider.requestsThisScan,
      cached: discovery.provider.cached ?? false, stale: discovery.provider.stale ?? false,
      externalMarketDataRequired: false,
      discoveredDexes: [...new Set(pools.map(p => p.dex))].sort(),
      supportedQuoteKinds: [...new Set(pools.filter(p => p.quoteKind !== "unsupported").map(p => p.quoteKind))].sort(),
      note: "Discovery spans indexed Monad DEX pools; profitability is accepted only after exact sequential on-chain quotes."
    },
    execution: { live: false, transactionsSubmitted: 0, reason: "Arbitrage execution is disabled; this endpoint only discovers and simulates routes." }
  };
}