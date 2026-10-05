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
// LST arbitrage scanner: DexPaprika + DEX Screener topology discovery with exact on-chain quotes.
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

export const MIN_LIQUIDITY_USD = 1;
export const MIN_GROSS_EDGE_PCT = 0.15;
export const EXECUTION_BUFFER_PCT = 0.20;
export const MIN_NET_PROFIT_MON = 0.005;
export const GAS_BUFFER_MON = 0.001;
export const TRADE_SIZES_MON = [1, 5, 10];
export const MAX_EXACT_ROUTES = 6;
export const MAX_REFINED_ROUTES = 1;
// Search every simple closed route possible across the six configured assets.
// A closed arbitrage path needs at least 2 hops; six is the maximum without revisiting an asset.
export const MAX_ARBITRAGE_HOPS = 6;
export const PROBE_SIZE_MON = 1;
const EXECUTION_BUFFER_BPS = Math.round(EXECUTION_BUFFER_PCT * 100);
const DEXPAPRIKA_NETWORK = "monad";
const DEXPAPRIKA_BASE_URL = "https://api.dexpaprika.com";
const DEXPAPRIKA_CACHE_TTL_MS = 5 * 60_000;
const DEXPAPRIKA_ASSET_LIMIT = 100;
const DEXPAPRIKA_PRICE_BATCH_LIMIT = 10;
const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
const DEXSCREENER_CACHE_TTL_MS = 5 * 60_000;
const FREE_EXTERNAL_SUBREQUEST_LIMIT = 50;
const PLANNED_DISCOVERY_REQUESTS = 7;
const PLANNED_EXACT_REQUESTS =
  MAX_EXACT_ROUTES * 3 * 2 + TRADE_SIZES_MON.length;
const PLANNED_DISCOVERY_FALLBACK_REQUESTS = 0;
const PLANNED_WORST_CASE_EXTERNAL_REQUESTS =
  PLANNED_DISCOVERY_REQUESTS +
  PLANNED_EXACT_REQUESTS +
  PLANNED_DISCOVERY_FALLBACK_REQUESTS;
const PANCAKE_V3_QUOTER_V2 = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as Address;
const UNISWAP_V4_POOL_MANAGER =
  "0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e" as Address;
const UNISWAP_V4_QUOTER =
  "0xa222Dd357A9076d1091Ed6Aa2e16C9742dD26891" as Address;
const LST_ARBITRAGE_BUILD_REVISION = "arb-broad-universe-edge-cache-v5-2026-10-05";
const KURU_EXCHANGE_INFO_URL = "https://exchange.kuru.io/api/v3/exchangeInfo";
const KURU_DEPTH_URL = "https://exchange.kuru.io/api/v3/depth";
const KURU_MARKET_ABI = parseAbi([
  "function getMarketParams() view returns (uint256 pricePrecision,uint256 sizePrecision,address baseAssetAddress,uint256 baseAssetDecimals,address quoteAssetAddress,uint256 quoteAssetDecimals,uint256 tickSize,uint256 minSize,uint256 maxSize,int256 takerFeeBps,int256 makerFeeBps)"
]);

const V2_PAIR_ABI = parseAbi([
  "function token0() view returns (address)",
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)"
]);

const V4_INITIALIZE_EVENT_ABI = parseAbi([
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)"
]);

const V4_QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) returns (uint256 amountOut,uint256 gasEstimate)"
]);

const QUOTER_V2_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
]);

const UNISWAP_V3_POOL_ABI = parseAbi([
  "function fee() view returns (uint24)"
]);

const CURVE_POOL_ABI = parseAbi([
  "function get_dy(int128 i,int128 j,uint256 dx) view returns (uint256)"
]);

export type LSTArbitrageCache = {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
};

const PROVIDER_COOLDOWN_MS = 15 * 60_000;
const DEXPAPRIKA_CACHE_PREFIX = "lst-arb:dexpaprika";
const PROVIDER_BLOCK_KEY = "lst-arb:dexpaprika:blocked-until";
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

type QuoteKind = "uniswap-v4" | "uniswap-v3" | "uniswap-v2" | "pancake-v3" | "pancake-v2" | "curve-lst" | "kuru" | "unsupported";
type KuruMarket = {
  symbol: string;
  status: string;
  marketAddress: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetAddress: string;
  quoteAssetAddress: string;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  pricePrecision: number;
  sizePrecision: bigint;
  tickSize: bigint;
  minSize: bigint;
  maxSize: bigint;
  takerFeeBps: number;
  makerFeeBps: number;
};

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
  createdAtBlock?: string;
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
    feePct: number | null;
    feeBps: number | null;
    feeSource?: string;
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
  createdAtBlock?: string;
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

function bytes32(value: unknown) {
  const raw = String(value ?? "").toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(raw) ? raw : "";
}

function tokenIdentifier(value: unknown) {
  if (typeof value === "string") return addr(value);
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  return addr(item.id ?? item.token_id ?? item.address ?? item.tokenAddress);
}

function tokenSymbol(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  const item = value as Record<string, unknown>;
  const attributes =
    item.attributes &&
    typeof item.attributes === "object"
      ? item.attributes as Record<string, unknown>
      : null;
  const symbol = String(
    item.symbol ??
      attributes?.symbol ??
      ""
  ).trim();
  return symbol || fallback;
}

function tokenDecimals(value: unknown, fallback = 18) {
  if (!value || typeof value !== "object") return fallback;
  const item = value as Record<string, unknown>;
  const attributes =
    item.attributes &&
    typeof item.attributes === "object"
      ? item.attributes as Record<string, unknown>
      : null;
  const decimals = Number(
    item.decimals ??
      attributes?.decimals
  );
  return Number.isFinite(decimals) &&
    decimals >= 0 &&
    decimals <= 36
    ? decimals
    : fallback;
}

function poolIdentifier(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (bytes32(raw)) return raw;
  return addr(raw);
}

function shortAddress(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "UNKNOWN";
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


const EDGE_CACHE_TTL_MS = 5 * 60_000;
const EDGE_CACHE_PREFIX = "geld-lst-arb-v5";

const memoryProviderCache = new Map<string, CacheEntry<any>>();
const memoryProviderInflight = new Map<string, Promise<any>>();

function edgeCacheRequest(key: string) {
  return new Request(
    `https://geld-cache.invalid/${EDGE_CACHE_PREFIX}/${encodeURIComponent(key)}`
  );
}

async function readEdgeCache<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const response = await caches.default.match(edgeCacheRequest(key));
    if (!response) return null;
    const raw = await response.text();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.fetchedAt === "number" && "data" in parsed) {
      return parsed as CacheEntry<T>;
    }
  } catch {
    // Edge cache is an optimization; never let it break the scanner.
  }
  return null;
}

async function writeEdgeCache<T>(key: string, data: T, fetchedAt = Date.now()) {
  try {
    const response = new Response(
      JSON.stringify({ fetchedAt, data }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${Math.floor(EDGE_CACHE_TTL_MS / 1000)}`
        }
      }
    );
    await caches.default.put(edgeCacheRequest(key), response);
  } catch {
    // Edge cache is best-effort.
  }
}

function dynamicAsset(address: string, known: Map<string, ArbitrageAsset>): ArbitrageAsset {
  const normalized = address.toLowerCase();
  const existing = known.get(normalized);
  if (existing) return existing;
  return {
    symbol: `TKN_${normalized.slice(2, 8).toUpperCase()}`,
    address: normalized,
    decimals: 18
  };
}

async function fetchProviderJson<T>(
  key: string,
  url: string,
  headers: Record<string, string>,
  ttlMs = EDGE_CACHE_TTL_MS
): Promise<{ data: T; fetchedAt: number; fromCache: boolean }> {
  const now = Date.now();
  const memory = memoryProviderCache.get(key);
  if (memory && now - memory.fetchedAt < ttlMs) {
    return { data: memory.data as T, fetchedAt: memory.fetchedAt, fromCache: true };
  }

  const edge = await readEdgeCache<T>(key);
  if (edge && now - edge.fetchedAt < ttlMs) {
    memoryProviderCache.set(key, edge as CacheEntry<any>);
    return { data: edge.data, fetchedAt: edge.fetchedAt, fromCache: true };
  }

  const existing = memoryProviderInflight.get(key);
  if (existing) {
    const result = await existing as { data: T; fetchedAt: number; fromCache: boolean };
    return result;
  }

  const promise = (async () => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    const data = await response.json() as T;
    const fetchedAt = Date.now();
    const entry = { fetchedAt, data };
    memoryProviderCache.set(key, entry);
    await writeEdgeCache(key, data, fetchedAt);
    return { data, fetchedAt, fromCache: false };
  })();

  memoryProviderInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    memoryProviderInflight.delete(key);
  }
}

async function discoverDexPaprikaMonadPools(
  cache?: LSTArbitrageCache,
  apiKey?: string
) {
  const now = Date.now();
  const knownAssets = assetMap();
  const errors: string[] = [];
  const pools: any[] = [];
  const discoveredAssets = new Map<string, ArbitrageAsset>(knownAssets);
  let requestsThisScan = 0;
  let priceRequestsThisScan = 0;
  let providerBlocked = false;
  let blockedUntil = 0;

  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "geld-lst-arbitrage/1.0"
  };
  if (apiKey) headers.authorization = apiKey;

  const blockedEntry = await readCache<number>(cache, PROVIDER_BLOCK_KEY);
  const persistedBlockedUntil = Number(blockedEntry?.data ?? 0);
  if (Number.isFinite(persistedBlockedUntil) && persistedBlockedUntil > now) {
    blockedUntil = persistedBlockedUntil;
    providerBlocked = true;
  }

  const poolCacheKey = `${DEXPAPRIKA_CACHE_PREFIX}:network-pools:v2`;
  let networkRows: any[] = [];
  let poolFromCache = false;

  if (!providerBlocked) {
    try {
      const result = await fetchProviderJson<any>(
        poolCacheKey,
        `${DEXPAPRIKA_BASE_URL}/networks/${DEXPAPRIKA_NETWORK}/pools/search?order_by=volume_usd_24h&sort=desc&limit=60`,
        headers,
        DEXPAPRIKA_CACHE_TTL_MS
      );
      networkRows = Array.isArray(result.data?.results) ? result.data.results : [];
      poolFromCache = result.fromCache;
      if (!result.fromCache) requestsThisScan++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      const status = Number(message.match(/HTTP (\\d+)/)?.[1] ?? 0);
      if (status === 402 || status === 429) {
        blockedUntil = now + PROVIDER_COOLDOWN_MS;
        providerBlocked = true;
        await writeCache(cache, PROVIDER_BLOCK_KEY, blockedUntil, now);
      }
    }
  }

  // If DexPaprika is temporarily unavailable, let the existing DEX Screener
  // fallback discover the monitored universe without spending more than the
  // remaining discovery budget.
  if (providerBlocked || networkRows.length === 0) {
    const fallback = await discoverDexScreenerMonadPools(
      cache,
      Math.max(0, PLANNED_DISCOVERY_REQUESTS - requestsThisScan)
    );
    const fallbackAssets = [...knownAssets.values()];
    for (const pool of fallback.pools) {
      const base = addr(pool?.relationships?.base_token?.data?.id);
      const quote = addr(pool?.relationships?.quote_token?.data?.id);
      if (base) discoveredAssets.set(base, dynamicAsset(base, knownAssets));
      if (quote) discoveredAssets.set(quote, dynamicAsset(quote, knownAssets));
    }
    for (const pool of fallback.pools) {
      const key = String(pool?.attributes?.address ?? pool?.id).toLowerCase();
      if (!pools.some(existing => String(existing?.attributes?.address ?? existing?.id).toLowerCase() === key)) {
        pools.push(pool);
      }
    }
    return {
      pools,
      assets: [...discoveredAssets.values()],
      provider: {
        source: "dexpaprika",
        network: DEXPAPRIKA_NETWORK,
        requestsThisScan: requestsThisScan + fallback.provider.requestsThisScan,
        priceRequestsThisScan,
        assetQueries: 0,
        assetLimit: 60,
        refreshedAssets: [],
        cachedAssets: poolFromCache ? ["NETWORK"] : [],
        blockedUntil: blockedUntil > now ? blockedUntil : null,
        cacheTtlMs: DEXPAPRIKA_CACHE_TTL_MS,
        availableDexes: [...new Set(pools.map(pool => String(pool?.__dexMeta?.id ?? "").toLowerCase()).filter(Boolean))].sort(),
        fallbackUsed: fallback.pools.length > 0,
        fallbackSource: fallback.provider.source,
        fallbackRequestsThisScan: fallback.provider.requestsThisScan,
        fallbackRefreshedAssets: fallback.provider.refreshedAssets,
        fallbackCachedAssets: fallback.provider.cachedAssets,
        fallbackAvailableDexes: fallback.provider.availableDexes,
        fallbackErrors: fallback.provider.errors,
        errors: errors.length ? [...new Set(errors.concat(fallback.provider.errors ?? []))] : fallback.provider.errors,
        note:
          "Network-wide topology discovery is cached at the edge. Exact on-chain quotes remain the only profitability gate."
      }
    };
  }

  const supportedDexes = new Set([
    "uniswap_v4",
    "uniswap_v3",
    "uniswap_v2",
    "pancakeswap_v3",
    "pancakeswap_v2"
  ]);

  const candidateRows = networkRows.filter(row => {
    const dex = String(row?.dex_id ?? "").toLowerCase();
    return supportedDexes.has(dex) && num(row?.liquidity_usd) >= MIN_LIQUIDITY_USD;
  });

  const tokenAddresses = new Set<string>();
  for (const row of candidateRows) {
    const tokens = Array.isArray(row?.tokens) ? row.tokens : [];
    for (const token of tokens.slice(0, 2)) {
      const normalized = normalizeAssetAddress(token?.id);
      if (normalized) tokenAddresses.add(normalized);
    }
  }

  // DexPaprika's batch endpoint accepts 10 tokens per request. Keep this
  // bounded so discovery never crowds out exact RPC quoting on the Free plan.
  const priceList = [...tokenAddresses].slice(0, 30);
  const prices = new Map<string, number>();
  for (let i = 0; i < priceList.length; i += DEXPAPRIKA_PRICE_BATCH_LIMIT) {
    if (requestsThisScan >= PLANNED_DISCOVERY_REQUESTS) break;
    const batch = priceList.slice(i, i + DEXPAPRIKA_PRICE_BATCH_LIMIT);
    const key = `${DEXPAPRIKA_CACHE_PREFIX}:prices:${batch.join(",")}:v2`;
    try {
      const result = await fetchProviderJson<any>(
        key,
        `${DEXPAPRIKA_BASE_URL}/networks/${DEXPAPRIKA_NETWORK}/multi/prices?tokens=${batch.join(",")}`,
        headers,
        DEXPAPRIKA_CACHE_TTL_MS
      );
      if (!result.fromCache) {
        requestsThisScan++;
        priceRequestsThisScan++;
      }
      const rows = Array.isArray(result.data) ? result.data : Array.isArray(result.data?.results) ? result.data.results : [];
      for (const row of rows) {
        const token = normalizeAssetAddress(row?.id ?? row?.address);
        const price = num(row?.price_usd ?? row?.price);
        if (token && price > 0) prices.set(token, price);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      const status = Number(message.match(/HTTP (\\d+)/)?.[1] ?? 0);
      if (status === 402 || status === 429) {
        blockedUntil = now + PROVIDER_COOLDOWN_MS;
        providerBlocked = true;
        await writeCache(cache, PROVIDER_BLOCK_KEY, blockedUntil, now);
        break;
      }
    }
  }

  const deduped = new Map<string, any>();
  for (const row of candidateRows) {
    const tokens = Array.isArray(row?.tokens) ? row.tokens : [];
    if (tokens.length < 2) continue;

    const token0 = normalizeAssetAddress(tokens[0]?.id);
    const token1 = normalizeAssetAddress(tokens[1]?.id);
    if (!token0 || !token1 || token0 === token1) continue;

    const p0 = prices.get(token0);
    const p1 = prices.get(token1);
    if (!(p0 && p1 && p0 > 0 && p1 > 0)) continue;

    const baseAsset = dynamicAsset(token0, knownAssets);
    const quoteAsset = dynamicAsset(token1, knownAssets);
    discoveredAssets.set(token0, baseAsset);
    discoveredAssets.set(token1, quoteAsset);

    const dexId = String(row?.dex_id ?? "").toLowerCase();
    let quoteKind: QuoteKind = "unsupported";
    if (dexId === "uniswap_v4") quoteKind = "uniswap-v4";
    else if (dexId === "uniswap_v3") quoteKind = "uniswap-v3";
    else if (dexId === "uniswap_v2") quoteKind = "uniswap-v2";
    else if (dexId === "pancakeswap_v3") quoteKind = "pancake-v3";
    else if (dexId === "pancakeswap_v2") quoteKind = "pancake-v2";

    const poolAddress = poolIdentifier(row?.id);
    if (!poolAddress || quoteKind === "unsupported") continue;

    const baseToQuote = p0 / p1;
    if (!(baseToQuote > 0)) continue;

    const pool = {
      id: String(row?.id ?? poolAddress),
      attributes: {
        address: poolAddress,
        name: `${baseAsset.symbol}/${quoteAsset.symbol} ${String(row?.dex_name ?? row?.dex_id ?? "dex")}`,
        base_token_price_quote_token: String(baseToQuote),
        pool_fee_percentage: num(row?.fee),
        reserve_in_usd: num(row?.liquidity_usd),
        volume_usd: { h24: num(row?.volume_usd_24h) }
      },
      relationships: {
        base_token: { data: { id: token0 } },
        quote_token: { data: { id: token1 } },
        dex: { data: { id: dexId } }
      },
      __baseTokenMeta: { attributes: { address: token0, symbol: baseAsset.symbol, decimals: baseAsset.decimals } },
      __quoteTokenMeta: { attributes: { address: token1, symbol: quoteAsset.symbol, decimals: quoteAsset.decimals } },
      __dexMeta: { id: dexId },
      __quoteKind: quoteKind,
      __createdAtBlock: row?.created_at_block_number
    };

    deduped.set(poolAddress.toLowerCase(), pool);
  }

  return {
    pools: [...deduped.values()],
    assets: [...discoveredAssets.values()],
    provider: {
      source: "dexpaprika",
      network: DEXPAPRIKA_NETWORK,
      requestsThisScan,
      priceRequestsThisScan,
      assetQueries: 0,
      assetLimit: 60,
      refreshedAssets: poolFromCache ? [] : ["NETWORK"],
      cachedAssets: poolFromCache ? ["NETWORK"] : [],
      blockedUntil: blockedUntil > now ? blockedUntil : null,
      cacheTtlMs: DEXPAPRIKA_CACHE_TTL_MS,
      availableDexes: [...new Set([...deduped.values()].map(pool => String(pool?.__dexMeta?.id ?? "").toLowerCase()).filter(Boolean))].sort(),
      fallbackUsed: false,
      fallbackSource: undefined as string | undefined,
      fallbackRequestsThisScan: 0,
      fallbackRefreshedAssets: [] as string[],
      fallbackCachedAssets: [] as string[],
      fallbackAvailableDexes: [] as string[],
      fallbackErrors: undefined as string[] | undefined,
      errors: errors.length ? [...new Set(errors)] : undefined,
      note:
        "Network-wide top pools are discovered once, cached for 5 minutes, and expanded beyond the original LST set. Discovery only generates candidates; exact on-chain quotes decide profitability."
    }
  };
}
async function discoverDexScreenerMonadPools(cache: LSTArbitrageCache | undefined, maxRequests: number) {
  const assets = assetMap();
  const pools: any[] = [];
  const refreshedAssets: string[] = [];
  const cachedAssets: string[] = [];
  const errors: string[] = [];
  let requestsThisScan = 0;

  for (const asset of ARBITRAGE_ASSETS) {
    if (requestsThisScan >= maxRequests) break;
    const cacheKey = `lst-arb:dexscreener:pairs:${asset.address.toLowerCase()}:v1`;
    const cached = await readCache<any[]>(cache, cacheKey);
    let rows: any[] = [];

    if (cached && Date.now() - cached.fetchedAt < DEXSCREENER_CACHE_TTL_MS) {
      rows = cached.data ?? [];
      cachedAssets.push(asset.symbol);
    } else {
      try {
        const response = await fetch(
          `${DEXSCREENER_BASE_URL}/token-pairs/v1/monad/${asset.address}`,
          { headers: { accept: "application/json", "user-agent": "geld-lst-arbitrage/1.0" } }
        );
        requestsThisScan++;
        if (!response.ok) throw new Error(`DexScreener pairs HTTP ${response.status} for ${asset.symbol}`);
        const json = await response.json() as any;
        rows = Array.isArray(json) ? json : [];
        await writeCache(cache, cacheKey, rows);
        refreshedAssets.push(asset.symbol);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        if (cached?.data?.length) {
          rows = cached.data;
          cachedAssets.push(asset.symbol);
        }
      }
    }

    for (const row of rows) {
      const base = normalizeAssetAddress(row?.baseToken?.address);
      const quote = normalizeAssetAddress(row?.quoteToken?.address);
      if (!base || !quote || base === quote || !assets.has(base) || !assets.has(quote)) continue;
      const baseAsset = assets.get(base)!;
      const quoteAsset = assets.get(quote)!;
      const baseUsd = num(row?.priceUsd);
      const priceNative = num(row?.priceNative);
      const baseToQuote =
        quoteAsset.symbol === "WMON" && priceNative > 0
          ? priceNative
          : baseUsd > 0 && quoteAsset.symbol === "USDC"
            ? baseUsd
            : 0;
      if (!(baseToQuote > 0)) continue;

      const dex = String(row?.dexId ?? "").toLowerCase();
      const labels = Array.isArray(row?.labels) ? row.labels.map((x: unknown) => String(x).toLowerCase()) : [];
      let quoteKind: QuoteKind = "unsupported";
      if (dex === "uniswap" && labels.includes("v3")) quoteKind = "uniswap-v3";
      else if (dex === "uniswap" && labels.includes("v2")) quoteKind = "uniswap-v2";
      else if (dex === "pancakeswap" && labels.includes("v3")) quoteKind = "pancake-v3";
      else if (dex === "pancakeswap" && labels.includes("v2")) quoteKind = "pancake-v2";

      const poolAddress = addr(row?.pairAddress);
      if (!poolAddress) continue;
      pools.push({
        id: poolAddress,
        attributes: {
          address: poolAddress,
          name: `${baseAsset.symbol}/${quoteAsset.symbol} ${dex}${labels.length ? ` ${labels.join("/")}` : ""}`,
          base_token_price_quote_token: String(baseToQuote),
          pool_fee_percentage: 0,
          reserve_in_usd: num(row?.liquidity?.usd),
          volume_usd: { h24: num(row?.volume?.h24) }
        },
        relationships: {
          base_token: { data: { id: base } },
          quote_token: { data: { id: quote } },
          dex: { data: { id: dex } }
        },
        __baseTokenMeta: { attributes: { address: base, symbol: baseAsset.symbol, decimals: baseAsset.decimals } },
        __quoteTokenMeta: { attributes: { address: quote, symbol: quoteAsset.symbol, decimals: quoteAsset.decimals } },
        __dexMeta: { id: dex },
        __quoteKind: quoteKind
      });
    }
  }

  const deduped = new Map<string, any>();
  for (const pool of pools) {
    const key = String(pool?.attributes?.address ?? pool?.id).toLowerCase();
    if (!deduped.has(key)) deduped.set(key, pool);
  }
  return {
    pools: [...deduped.values()],
    provider: {
      source: "dexscreener-fallback",
      network: "monad",
      requestsThisScan,
      refreshedAssets,
      cachedAssets,
      errors: errors.length ? [...new Set(errors)] : undefined,
      availableDexes: [...new Set([...deduped.values()].map(pool => String(pool?.__dexMeta?.id ?? "").toLowerCase()).filter(Boolean))].sort()
    }
  };
}

function parseDiscoveredPool(
  record: any,
  assets: Map<string, ArbitrageAsset>
): PoolRecord | null {
  const a = record?.attributes ?? {};
  const relationships = record?.relationships ?? {};
  const baseMeta = record?.__baseTokenMeta?.attributes ?? {};
  const quoteMeta = record?.__quoteTokenMeta?.attributes ?? {};

  const base =
    addr(baseMeta?.address) ||
    addr(relationships?.base_token?.data?.id) ||
    addr(a?.base_token_address);
  const quote =
    addr(quoteMeta?.address) ||
    addr(relationships?.quote_token?.data?.id) ||
    addr(a?.quote_token_address);

  const nativeZero = "0x0000000000000000000000000000000000000000";
  if (!base || !quote || base === quote || base === nativeZero || quote === nativeZero) return null;

  const baseAsset = assets.get(base);
  const quoteAsset = assets.get(quote);
  if (!baseAsset || !quoteAsset) return null;

  const baseToQuote = num(a.base_token_price_quote_token);
  if (!(baseToQuote > 0)) return null;

  const dex = String(
    relationships?.dex?.data?.id ??
    record?.__dexMeta?.id ??
    ""
  ).toLowerCase();

  const poolAddress = poolIdentifier(a.address ?? record?.id);
  if (!poolAddress) return null;

  return {
    id: String(record?.id ?? poolAddress),
    name: String(a.name ?? `${baseAsset.symbol}/${quoteAsset.symbol} ${dex}`),
    address: poolAddress,
    base,
    quote,
    baseSymbol: baseAsset.symbol,
    quoteSymbol: quoteAsset.symbol,
    baseToQuote,
    feePct: inferV3FeePct(String(a.name ?? ""), num(a.pool_fee_percentage)),
    liquidityUsd: num(a.reserve_in_usd),
    volume24hUsd: num(a.volume_usd?.h24),
    dex,
    quoteKind: record?.__quoteKind && record.__quoteKind !== "unsupported" ? record.__quoteKind : classifyQuoteKind(poolAddress, dex),
    createdAtBlock: record?.__createdAtBlock ? String(record.__createdAtBlock) : undefined
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


function inferV3FeePct(name: string, fallback: number) {
  if (fallback > 0) return fallback;
  const match = name.match(/(0\.01|0\.02|0\.03|0\.04|0\.05|0\.1|0\.2|0\.3|1(?:\.0)?)%/i);
  return match ? Number(match[1]) : 0;
}

function classifyQuoteKind(address: string, dex: string) {
  const d = dex.toLowerCase();
  if (
    address.toLowerCase() ===
    CURVE_LST_POOL.toLowerCase()
  ) {
    return "curve-lst" as const;
  }
  if (
    d === "uniswap-v4-monad" ||
    d === "uniswap_v4"
  ) {
    return "uniswap-v4" as const;
  }
  if (
    d === "uniswap-v3-monad" ||
    d === "uniswap_v3"
  ) {
    return "uniswap-v3" as const;
  }
  if (
    d === "uniswap-v2-monad" ||
    d === "uniswap_v2"
  ) {
    return "uniswap-v2" as const;
  }
  if (
    d === "pancakeswap-v3-monad" ||
    d === "pancakeswap_v3" ||
    d === "pancake_v3"
  ) {
    return "pancake-v3" as const;
  }
  if (
    d === "pancakeswap-v2-monad" ||
    d === "pancakeswap_v2" ||
    d === "pancake_v2"
  ) {
    return "pancake-v2" as const;
  }
  if (d === "kuru") return "kuru" as const;
  return "unsupported" as const;
}

function isExactQuoteSupported(kind: QuoteKind) {
  return (
    kind === "curve-lst" ||
    kind === "uniswap-v4" ||
    kind === "uniswap-v3" ||
    kind === "uniswap-v2" ||
    kind === "pancake-v3" ||
    kind === "pancake-v2"
  );
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
    quoteKind: pool.quoteKind,
    createdAtBlock: pool.createdAtBlock
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
    quoteKind: pool.quoteKind,
    createdAtBlock: pool.createdAtBlock
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
function findCycles(edges: PoolEdge[], startAddress: string, maxHops = MAX_ARBITRAGE_HOPS): any[] {
  const byFrom = new Map<string, PoolEdge[]>();

  for (const edge of edges) {
    const list = byFrom.get(edge.from) ?? [];
    list.push(edge);
    byFrom.set(edge.from, list);
  }

  const results: any[] = [];
  const seen = new Set<string>();

  function pushRoute(legs: PoolEdge[]) {
    if (legs.length < 2) return;

    const distinctPools = new Set(
      legs.map(leg => leg.pool.toLowerCase())
    );
    if (distinctPools.size < 2) return;

    const assets = [
      legs[0].from,
      ...legs.map(leg => leg.to)
    ];

    const key = [
      ...assets.map(asset => asset.toLowerCase()),
      ...legs.map(leg => leg.pool.toLowerCase())
    ].join(":");

    if (seen.has(key)) return;
    seen.add(key);

    const multiplier = legs.reduce(
      (value, leg) => value * (leg.rate > 0 ? leg.rate : 1),
      1
    );

    results.push({
      path: legs.flatMap((leg, index) =>
        index === 0
          ? [leg.fromSymbol, leg.toSymbol]
          : [leg.toSymbol]
      ),
      assets,
      legs,
      hopCount: legs.length,
      multiplier,
      grossEdgePct: (multiplier - 1) * 100,
      exactQuoteSupported: legs.every(
        leg => isExactQuoteSupported(
          leg.quoteKind
        )
      )
    });
  }

  function walk(
    current: string,
    legs: PoolEdge[],
    visitedAssets: Set<string>
  ) {
    if (current === startAddress && legs.length >= 2) {
      pushRoute(legs);
      return;
    }

    if (legs.length >= maxHops) return;

    for (const edge of byFrom.get(current) ?? []) {
      if (legs.length === 0 && edge.to === startAddress) continue;

      if (edge.to === startAddress) {
        if (legs.length + 1 >= 2) {
          pushRoute([...legs, edge]);
        }
        continue;
      }

      if (visitedAssets.has(edge.to)) continue;

      walk(
        edge.to,
        [...legs, edge],
        new Set([...visitedAssets, edge.to])
      );
    }
  }

  walk(startAddress, [], new Set([startAddress]));
  return results;
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
  kuruParamsCache: Map<string, any>,
  uniswapFeeCache: Map<string, number>,
  v4KeyCache: Map<string, {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  } | null>
): Promise<{
  amountOut: bigint;
  gasEstimate?: bigint;
  feeBps?: number | null;
  feePct?: number | null;
  feeSource?: string;
} | null> {
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
    return {
      amountOut,
      feeBps: null,
      feePct: null,
      feeSource: "curve_pool_quote"
    };
  }

  if (edge.quoteKind === "uniswap-v4") {
    const cacheKey = edge.pool.toLowerCase();
    let poolKey = v4KeyCache.get(cacheKey);

    if (poolKey === undefined) {
      try {
        const logQuery: any = {
          address: UNISWAP_V4_POOL_MANAGER,
          event: V4_INITIALIZE_EVENT_ABI[0],
          args: { id: edge.pool as `0x${string}` }
        };
        if (edge.createdAtBlock) {
          logQuery.fromBlock = BigInt(edge.createdAtBlock);
          logQuery.toBlock = BigInt(edge.createdAtBlock);
        }
        const logs = await client.getLogs(logQuery);

        const log = logs[logs.length - 1] as any;
        if (!log?.args) {
          v4KeyCache.set(cacheKey, null);
          return null;
        }

        poolKey = {
          currency0: String(log.args.currency0),
          currency1: String(log.args.currency1),
          fee: Number(log.args.fee),
          tickSpacing: Number(log.args.tickSpacing),
          hooks: String(log.args.hooks)
        };
        v4KeyCache.set(cacheKey, poolKey);
      } catch {
        v4KeyCache.set(cacheKey, null);
        return null;
      }
    }

    if (
      !poolKey ||
      !Number.isFinite(poolKey.fee) ||
      !Number.isFinite(poolKey.tickSpacing)
    ) {
      return null;
    }

    const currency0 = normalizeAssetAddress(poolKey.currency0);
    const currency1 = normalizeAssetAddress(poolKey.currency1);

    let zeroForOne: boolean;
    if (
      edge.from.toLowerCase() === currency0 &&
      edge.to.toLowerCase() === currency1
    ) {
      zeroForOne = true;
    } else if (
      edge.from.toLowerCase() === currency1 &&
      edge.to.toLowerCase() === currency0
    ) {
      zeroForOne = false;
    } else {
      return null;
    }

    const result = await client.readContract({
      address: UNISWAP_V4_QUOTER,
      abi: V4_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          currency0: poolKey.currency0 as Address,
          currency1: poolKey.currency1 as Address,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks as Address
        },
        zeroForOne,
        amountIn,
        "0x"
      ]
    });

    const values = result as readonly [bigint, bigint];
    return {
      amountOut: values[0],
      gasEstimate: values[1],
      feeBps: poolKey.fee / 100,
      feePct: poolKey.fee / 10_000,
      feeSource: "uniswap_v4_initialize_event"
    };
  }

  if (edge.quoteKind === "uniswap-v3" || edge.quoteKind === "pancake-v3") {
    let feeBps = Math.round(edge.feePct * 10_000);
    if (!(feeBps > 0)) {
      const cachedFee = uniswapFeeCache.get(edge.pool.toLowerCase());
      if (cachedFee !== undefined) {
        feeBps = cachedFee;
      } else {
        const poolFee = await client.readContract({ address: edge.pool as Address, abi: UNISWAP_V3_POOL_ABI, functionName: "fee" });
        feeBps = Number(poolFee);
        uniswapFeeCache.set(edge.pool.toLowerCase(), feeBps);
      }
    }
    if (!(feeBps > 0 && feeBps <= 1_000_000)) return null;
    const result = await client.readContract({
      address: edge.quoteKind === "pancake-v3" ? PANCAKE_V3_QUOTER_V2 : UNISWAP_V3_QUOTER_V2,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: edge.from as Address, tokenOut: edge.to as Address, amountIn, fee: feeBps, sqrtPriceLimitX96: 0n }]
    });
    const values = result as readonly [bigint, bigint, number, bigint];
    return {
      amountOut: values[0],
      gasEstimate: values[3],
      feeBps: feeBps / 100,
      feePct: feeBps / 10_000,
      feeSource: "pool.fee()"
    };
  }

  if (edge.quoteKind === "uniswap-v2" || edge.quoteKind === "pancake-v2") {
    const token0 = await client.readContract({ address: edge.pool as Address, abi: V2_PAIR_ABI, functionName: "token0" });
    const reserves = await client.readContract({ address: edge.pool as Address, abi: V2_PAIR_ABI, functionName: "getReserves" });
    const [reserve0, reserve1] = reserves as readonly [bigint, bigint, number];
    const [reserveIn, reserveOut] = edge.from.toLowerCase() === String(token0).toLowerCase() ? [reserve0, reserve1] : [reserve1, reserve0];
    if (reserveIn <= 0n || reserveOut <= 0n) return null;
    const feeBps = edge.quoteKind === "pancake-v2" ? 25n : 30n;
    const feeBpsNumber = Number(feeBps);
    const amountInWithFee = amountIn * (10_000n - feeBps);
    const amountOut = amountInWithFee * reserveOut / (reserveIn * 10_000n + amountInWithFee);
    return amountOut > 0n
      ? {
          amountOut,
          feeBps: feeBpsNumber,
          feePct: feeBpsNumber / 100,
          feeSource:
            edge.quoteKind === "pancake-v2"
              ? "pancakeswap_v2_default"
              : "uniswap_v2_default"
        }
      : null;
  }

  if (edge.quoteKind === "kuru") {
    // Kuru requires live orderbook state for an exact market fill. Keep it
    // discovery-visible but do not spend an RPC call on a discarded quote.
    return null;
  }
  return null;
}

async function simulateCycle(
  client: ReturnType<typeof createClient>,
  cycle: any,
  sizeMon: number,
  kuruParamsCache: Map<string, any>,
  uniswapFeeCache: Map<string, number>,
  v4KeyCache: Map<string, {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  } | null>
) {
  let amount = parseUnits(String(sizeMon), 18);
  const exactLegs = [];
  const safetyNumerator = 10_000n - BigInt(EXECUTION_BUFFER_BPS);
  const safetyDenominator = 10_000n;

  try {
    for (const leg of cycle.legs) {
      const quote = await quoteExactEdge(client, leg, amount, kuruParamsCache, uniswapFeeCache, v4KeyCache);
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
        feePct: quote.feePct ?? leg.feePct ?? null,
        feeBps: quote.feeBps ?? null,
        feeSource: quote.feeSource ?? "discovery_metadata",
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
    for (let i = 0; i < cycle.legs.length; i++) {
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
  cache?: LSTArbitrageCache,
  apiKey?: string
) {
  const discovery = await discoverDexPaprikaMonadPools(cache, apiKey);
  const assets = new Map<string, ArbitrageAsset>(assetMap());
  for (const asset of discovery.assets ?? []) {
    assets.set(asset.address.toLowerCase(), asset);
  }

  const parsedPools = discovery.pools
    .map((record: any) => parseDiscoveredPool(record, assets))
    .filter(
      (pool: PoolRecord | null): pool is PoolRecord =>
        pool !== null
    );

  const poolByAddress = new Map<string, PoolRecord>();
  for (const pool of KNOWN_UNISWAP_POOLS) {
    poolByAddress.set(pool.address.toLowerCase(), pool);
  }
  for (const pool of parsedPools) {
    poolByAddress.set(pool.address.toLowerCase(), pool);
  }

  const pools = [...poolByAddress.values()];
  const edges: PoolEdge[] = [];

  for (const pool of pools) addEdge(edges, pool);
  addKnownCurveEdges(edges);

  const wmon =
    assets.get(
      "0x3bd359c1119da7da1d913d1c4d2b7c461115433a"
    ) ??
    ARBITRAGE_ASSETS.find(a => a.symbol === "WMON")!;

  const allRoutes = findCycles(
    edges,
    wmon.address.toLowerCase(),
    MAX_ARBITRAGE_HOPS
  )
    .filter((route) =>
      route.legs.every(
        (leg: PoolEdge) =>
          isExactQuoteSupported(leg.quoteKind)
      )
    )
    .filter(
      route =>
        new Set(
          route.legs.map((leg: PoolEdge) =>
            leg.pool.toLowerCase()
          )
        ).size >= 2
    )
    .map(route => ({
      ...route,
      distinctDexes: new Set(
        route.legs.map((leg: PoolEdge) =>
          leg.dex.toLowerCase()
        )
      ).size,
      distinctPools: new Set(
        route.legs.map((leg: PoolEdge) =>
          leg.pool.toLowerCase()
        )
      ).size,
      liquidityScore: Math.min(
        ...route.legs.map((leg: PoolEdge) =>
          leg.liquidityUsd
        )
      ),
      volumeScore: route.legs.reduce(
        (sum: number, leg: PoolEdge) =>
          sum + leg.volume24hUsd,
        0
      )
    }))
    .sort(
      (a, b) =>
        (b.distinctDexes - a.distinctDexes) ||
        (b.distinctPools - a.distinctPools) ||
        (b.grossEdgePct - a.grossEdgePct) ||
        (b.liquidityScore - a.liquidityScore) ||
        (b.volumeScore - a.volumeScore)
    );

  const seenRouteKeys = new Set<string>();
  const remainingRoutes = allRoutes.filter(route => {
    const key = route.legs
      .map((leg: PoolEdge) => leg.pool.toLowerCase())
      .join("|");

    if (seenRouteKeys.has(key)) return false;
    seenRouteKeys.add(key);
    return true;
  });

  const probeRoutes: any[] = [];
  const coveredProbeDexes = new Set<string>();

  while (
    probeRoutes.length < MAX_EXACT_ROUTES &&
    remainingRoutes.length > 0
  ) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let index = 0; index < remainingRoutes.length; index++) {
      const route = remainingRoutes[index];
      const routeDexes = new Set<string>(
        route.legs.map((leg: PoolEdge) =>
          String(leg.dex).toLowerCase()
        )
      );
      const newDexCount = [
        ...routeDexes
      ].filter((dex: string) => !coveredProbeDexes.has(dex)).length;

      const score =
        newDexCount * 1_000_000 +
        route.distinctDexes * 10_000 +
        route.distinctPools * 1_000 +
        route.liquidityScore;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const [selected] = remainingRoutes.splice(bestIndex, 1);
    probeRoutes.push(selected);

    for (const leg of selected.legs) {
      coveredProbeDexes.add(leg.dex.toLowerCase());
    }
  }

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

  // Probe sequentially. Besides staying inside the Worker connection limit,
  // this prevents concurrent routes from racing the shared fee/log caches and
  // issuing duplicate RPC subrequests.
  const probes = [];
  for (const route of probeRoutes) {
    probes.push({
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
    });
  }

  const refinementRank = probes
    .map((route, index) => ({
      route,
      index
    }))
    .sort((a, b) => {
      const aq = a.route.exactQuotes[0];
      const bq = b.route.exactQuotes[0];

      const an =
        aq.ok === true
          ? aq.netProfitMon
          : -Infinity;
      const bn =
        bq.ok === true
          ? bq.netProfitMon
          : -Infinity;

      return (
        (bn - an) ||
        (b.route.distinctDexes -
          a.route.distinctDexes) ||
        (b.route.distinctPools -
          a.route.distinctPools) ||
        (b.route.liquidityScore -
          a.route.liquidityScore)
      );
    });

  const refineIndexes = new Set(
    refinementRank
      .filter(
        item =>
          item.route.exactQuotes[0].ok === true
      )
      .slice(0, MAX_REFINED_ROUTES)
      .map(item => item.index)
  );

  const exactResults = [];
  for (let index = 0; index < probes.length; index++) {
    const route = probes[index];
    if (!refineIndexes.has(index)) {
      exactResults.push(route);
      continue;
    }

    const exactQuotes = [];
    for (const size of TRADE_SIZES_MON) {
      exactQuotes.push(
        await simulateCycle(
          client,
          route,
          size,
          kuruParamsCache,
          uniswapFeeCache,
          v4KeyCache
        )
      );
    }

    exactResults.push({
      ...route,
      exactQuotes,
      refined: true
    });
  }

  const signals: ArbitrageSignal[] = [];

  for (const route of exactResults) {
    for (const q of route.exactQuotes) {
      if (q.ok !== true || q.candidate !== true) {
        continue;
      }

      signals.push({
        path: route.path,
        sizeMon: q.sizeMon,
        amountInRaw: parseUnits(
          String(q.sizeMon),
          18
        ).toString(),
        finalMon: q.finalMon,
        finalQuoteRaw: q.finalQuoteRaw,
        protectedFinalMon: q.protectedFinalMon,
        protectedFinalRaw: q.protectedFinalRaw,
        minFinalWmonRaw: q.minFinalWmonRaw,
        grossProfitMon: q.grossProfitMon,
        executionBufferMon: q.executionBufferMon,
        netProfitMon: q.netProfitMon,
        legs: q.exactLegs.map((leg: any) => ({
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
          feeSource: leg.feeSource,
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

  signals.sort(
    (a, b) => b.netProfitMon - a.netProfitMon
  );

  return {
    mode: "PAPER_SIGNAL_ONLY" as const,
    generatedAt: new Date().toISOString(),
    rpcUrl,
    buildRevision: LST_ARBITRAGE_BUILD_REVISION,
    assets: [...assets.values()],
    poolCount: pools.length,
    edgeCount: edges.length,
    triangleCount: allRoutes.length,
    cycleCount: allRoutes.length,
    routeCount: allRoutes.length,
    probeRouteCount: probeRoutes.length,
    availableDexCount:
      discovery.provider.availableDexes?.length ?? 0,
    exactSupportedDexCount: [
      ...new Set(
        pools
          .filter(pool =>
            isExactQuoteSupported(
              pool.quoteKind
            )
          )
          .map(pool => pool.dex)
      )
    ].length,
    refinedRouteCount: exactResults.filter(
      route => route.refined
    ).length,
    routes: exactResults,
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
      ...discovery.provider,
      parsedPoolCount: parsedPools.length,
      discoveredDexes: [
        ...new Set(pools.map(pool => pool.dex))
      ].sort(),
      supportedQuoteKinds: [
        ...new Set(
          pools
            .filter(
              pool => pool.quoteKind !== "unsupported"
            )
            .map(pool => pool.quoteKind)
        )
      ].sort(),
      exactSupportedDexes: [
        ...new Set(
          pools
            .filter(pool =>
              isExactQuoteSupported(
                pool.quoteKind
              )
            )
            .map(pool => pool.dex)
        )
      ].sort(),
      exactUnsupportedDexes: [
        ...new Set(
          pools
            .filter(pool =>
              !isExactQuoteSupported(
                pool.quoteKind
              )
            )
            .map(pool => pool.dex)
        )
      ].sort(),
      unsupportedQuoteKinds: [
        ...new Set(
          pools
            .filter(
              pool =>
                !isExactQuoteSupported(
                  pool.quoteKind
                )
            )
            .map(pool => pool.quoteKind)
        )
      ].sort(),
      probeDexes: [...coveredProbeDexes].sort(),
      note:
        "Routes are built from cached multi-DEX topology. Discovery data never becomes " +
        "a profitability result; only venues with validated exact quote adapters enter " +
        "routing, and every exact leg consumes the actual output of the prior leg."
    },
    externalRequestBudget: {
      freeTierLimit: FREE_EXTERNAL_SUBREQUEST_LIMIT,
      plannedDiscoveryRequests: PLANNED_DISCOVERY_REQUESTS,
      plannedExactAndRefinementRequests: PLANNED_EXACT_REQUESTS,
      plannedWorstCaseExternalRequests:
        PLANNED_WORST_CASE_EXTERNAL_REQUESTS,
      safetyMarginRequests: 4,
      headroom:
        FREE_EXTERNAL_SUBREQUEST_LIMIT -
        PLANNED_WORST_CASE_EXTERNAL_REQUESTS
    },
    execution: {
      live: false,
      attempted: false,
      submitted: false,
      transactionsSubmitted: 0,
      reason:
        "Paper-only scanner. No transaction submission is performed."
    },
    executionPolicy: {
      enabled: true,
      liveExecutionEnabled: false,
      requiresGlobalLiveTrading: true,
      executorConfigured: false
    }
  };
}