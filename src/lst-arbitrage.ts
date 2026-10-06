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
  encodeFunctionData,
  encodeAbiParameters,
  encodePacked,
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
export const MAX_EXACT_ROUTES = 4;
export const MAX_REFINED_ROUTES = 0;
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
const NADFUN_BASE_URL = "https://api.nad.fun";
const NADFUN_CACHE_TTL_MS = 60_000;
const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
const DEXSCREENER_CACHE_TTL_MS = 5 * 60_000;
const FREE_EXTERNAL_SUBREQUEST_LIMIT = 50;
const PLANNED_DISCOVERY_REQUESTS = 8;
const PLANNED_KYBER_SCOUT_REQUESTS = 12;
// A route with six hops can consume one external RPC call per exact leg.
// Keep enough headroom for provider/cache calls on the Free 50-subrequest plan.
const PLANNED_CACHE_API_CALLS = 10;
const PLANNED_EXACT_REQUESTS =
  MAX_EXACT_ROUTES * MAX_ARBITRAGE_HOPS;

const PLANNED_DISCOVERY_FALLBACK_REQUESTS = 0;
const PLANNED_WORST_CASE_EXTERNAL_REQUESTS =
  PLANNED_DISCOVERY_REQUESTS +
  PLANNED_KYBER_SCOUT_REQUESTS +
  PLANNED_EXACT_REQUESTS +
  PLANNED_DISCOVERY_FALLBACK_REQUESTS +
  PLANNED_CACHE_API_CALLS;
const PANCAKE_V3_QUOTER_V2 = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as Address;
const UNISWAP_V4_POOL_MANAGER =
  "0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e" as Address;
const UNISWAP_V4_QUOTER =
  "0xa222Dd357A9076d1091Ed6Aa2e16C9742dD26891" as Address;
const LST_ARBITRAGE_BUILD_REVISION = "arb-universal-token-discovery-v24-safe-gas-estimate-gating-2026-10-06";
const KURU_EXCHANGE_INFO_URL = "https://exchange.kuru.io/api/v3/exchangeInfo";
const KURU_DEPTH_URL = "https://exchange.kuru.io/api/v3/depth";
const KYBER_BASE_URL = "https://aggregator-api.kyberswap.com";
const KYBER_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const KYBER_CLIENT_ID = "GELD";
const KYBER_SIMULATION_SLIPPAGE_BPS = 30;
const UNISWAP_UNIVERSAL_ROUTER = "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7" as Address;
const PANCAKE_UNIVERSAL_ROUTER = "0x23682a588cf2601aca977df200938634c9f7d552" as Address;
const WMON_ADDRESS = "0x3bd359c1119da7da1d913d1c4d2b7c461115433a" as Address;
const UNIVERSAL_ROUTER_ABI = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"
]);
const ERC20_TX_ABI = parseAbi([
  "function transfer(address to,uint256 value) returns (bool)",
  "function approve(address spender,uint256 value) returns (bool)"
]);
const WMON_WRAP_ABI = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256)"
]);
const CURVE_SWAP_ABI = parseAbi([
  "function exchange(int128 i,int128 j,uint256 dx,uint256 minDy,address receiver) returns (uint256)"
]);
const ERC20_ALLOWANCE_ABI = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)"
]);
const KYBER_CACHE_TTL_MS = 30_000;
const KYBER_PROBE_SIZE_MON = 5;
const KYBER_SCOUT_TARGETS: Array<{symbol: string; address: string}> = [
  { symbol: "USDC", address: "0x754704bc059f8c67012fed69bc8a327a5aafb603" },
  { symbol: "AUSD", address: "0x00000000efe302beaa2b3e6e1b18d08d69a9012a" },
  { symbol: "WETH", address: "0xee8c0e9f1bffb4eb878d8f15f368a02a35481242" },
  { symbol: "gMON", address: "0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081" },
  { symbol: "sMON", address: "0xa3227c5969757783154c60bf0bc1944180ed81b9" },
  { symbol: "shMON", address: "0x1b68626dca36c7fe922fd2d55e4f631d962de19c" }
];
const KURU_MARKET_ABI = parseAbi([
  "function getMarketParams() view returns (uint256 pricePrecision,uint256 sizePrecision,address baseAssetAddress,uint256 baseAssetDecimals,address quoteAssetAddress,uint256 quoteAssetDecimals,uint256 tickSize,uint256 minSize,uint256 maxSize,int256 takerFeeBps,int256 makerFeeBps)",
  "function placeAndExecuteMarketBuy(uint96 quoteSize,uint256 minAmountOut,bool isMargin,bool isFillOrKill) payable returns (uint256)",
  "function placeAndExecuteMarketSell(uint96 size,uint256 minAmountOut,bool isMargin,bool isFillOrKill) payable returns (uint256)"
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

const PROVIDER_COOLDOWN_MS = 2 * 60_000;
const DEXPAPRIKA_CACHE_PREFIX = "lst-arb:dexpaprika";
const PROVIDER_BLOCK_KEY = "lst-arb:dexpaprika:blocked-until";
const DEXSCREENER_BLOCK_KEY = "lst-arb:dexscreener:blocked-until:v2";
const DEXSCREENER_BOOSTS_URL = DEXSCREENER_BASE_URL + "/token-boosts/latest/v1";
const DEXSCREENER_SEARCH_URL = DEXSCREENER_BASE_URL + "/latest/dex/search";
const DEXSCREENER_FRONTIER_CURSOR_KEY = "lst-arb:dexscreener:frontier-cursor:v1";
const DEXSCREENER_SEARCH_CURSOR_KEY = "lst-arb:dexscreener:search-cursor:v1";
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
  { symbol: "USDC", address: "0x754704bc059f8c67012fed69bc8a327a5aafb603", decimals: 6 },
  // High-liquidity / frequently traded Monad assets used as an expanded
  // arbitrage universe. Exact execution still requires a supported quote adapter.
  { symbol: "FLING", address: "0xa9da3c77ec7cdc4dfaa1fe142af583543d1c540f", decimals: 18 },
  { symbol: "ANAGO", address: "0x99ae2dc76c43979e3bcc0ae8d69f1fca077c8888", decimals: 18 },
  { symbol: "UNIT", address: "0x788571e0e5067adea87e6ba22a2b738ffdf48888", decimals: 18 },
  { symbol: "DUST", address: "0xad96c3dffcd6374294e2573a7fbba96097cc8d7c", decimals: 18 },
  { symbol: "ALLOCA", address: "0x1ad7052bb331a0529c1981c3ec2bc4663498a110", decimals: 18 },
  { symbol: "WBTC", address: "0x0555e30da8f98308edb960aa94c0db47230d2b9c", decimals: 8 },
  { symbol: "cbBTC", address: "0xd18b7ec58cdf4876f6afeb3ed1730e4ce10414b", decimals: 8 },
  { symbol: "WETH", address: "0xee8c0e9f1bffb4eb878d8f15f368a02a35481242", decimals: 18 },
  { symbol: "USDT0", address: "0xe7cd86e13ac4309349f30b3435a9d337750fc82d", decimals: 6 },
  { symbol: "AUSD", address: "0x00000000efe302beaa2b3e6e1b18d08d69a9012a", decimals: 6 },
  { symbol: "Cake", address: "0x01bff41798a0bcf287b996046ca68b395dbc1071", decimals: 18 }
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
  sizePrecision: string;
  tickSize: string;
  minSize: string;
  maxSize: string;
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
  kuruMarket?: KuruMarket;
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
  priceUsd?: number;
  dex: string;
  quoteKind: QuoteKind;
  createdAtBlock?: string;
  kuruMarket?: KuruMarket;
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
    const edgeCache = await caches.open(EDGE_CACHE_PREFIX);
    const response = await edgeCache.match(edgeCacheRequest(key));
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
    const edgeCache = await caches.open(EDGE_CACHE_PREFIX);
    await edgeCache.put(edgeCacheRequest(key), response);
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

async function discoverNadfunMonadTokens(
  cache?: LSTArbitrageCache,
  maxRequests = 2
) {
  const assets = new Map<string, ArbitrageAsset>(assetMap());
  const pools: any[] = [];
  const errors: string[] = [];
  let requestsThisScan = 0;
  const endpoints = [
    { key: "market-cap", path: "/order/market_cap?page=1&limit=50&is_nsfw=false" },
    { key: "newest", path: "/order/creation_time?page=1&limit=50&is_nsfw=false&direction=DESC" }
  ];

  for (const endpoint of endpoints.slice(0, Math.max(0, Math.min(2, Math.floor(maxRequests))))) {
    const cacheKey = "geld:arb:nadfun:" + endpoint.key + ":v1";
    try {
      const result = await fetchProviderJson<any>(
        cacheKey,
        NADFUN_BASE_URL + endpoint.path,
        { accept: "application/json", "user-agent": "geld-arbitrage/2.1" },
        NADFUN_CACHE_TTL_MS
      );

      if (!result.fromCache) requestsThisScan++;

      const rows = Array.isArray(result.data?.tokens) ? result.data.tokens : [];
      for (const row of rows) {
        const info = row?.token_info ?? {};
        const market = row?.market_info ?? {};
        const tokenAddress = normalizeAssetAddress(
          info?.token_id ?? market?.token_id ?? row?.address
        );
        const quoteAddress = normalizeAssetAddress(
          market?.quote_info?.quote_id
        );
        if (!tokenAddress || !quoteAddress || tokenAddress === quoteAddress) continue;

        const symbol = String(info?.symbol ?? ("TKN_" + tokenAddress.slice(2, 8).toUpperCase()));
        const decimals = Number(market?.quote_info?.decimals ?? 18);
        if (!assets.has(tokenAddress)) {
          assets.set(tokenAddress, {
            symbol,
            address: tokenAddress,
            decimals: 18
          });
        }

        const quoteSymbol = String(market?.quote_info?.symbol ?? "MON");
        if (!assets.has(quoteAddress)) {
          assets.set(quoteAddress, {
            symbol: quoteSymbol,
            address: quoteAddress,
            decimals: Number.isFinite(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18
          });
        }

        const reserveNative = Number(market?.reserve_native ?? 0) / 1e18;
        const nativePriceUsd = Number(market?.native_price ?? market?.quote_price ?? 0);
        const liquidityUsd =
          Number.isFinite(reserveNative) && reserveNative > 0 && nativePriceUsd > 0
            ? reserveNative * nativePriceUsd
            : 0;

        const volumeRaw = Number(market?.volume ?? 0) / 1e18;
        const volumeUsd =
          Number.isFinite(volumeRaw) && volumeRaw > 0 && nativePriceUsd > 0
            ? volumeRaw * nativePriceUsd
            : 0;

        const poolAddress = addr(market?.market_id);
        if (!poolAddress) continue;

        const priceUsd = Number(market?.price_usd ?? market?.token_price ?? 0);
        const priceNative = Number(market?.price_native ?? market?.price_quote ?? 0);

        pools.push({
          id: poolAddress,
          attributes: {
            address: poolAddress,
            name: symbol + "/" + quoteSymbol + " nad.fun",
            base_token_price_quote_token: String(priceNative > 0 ? priceNative : 1),
            pool_fee_percentage: 0,
            reserve_in_usd: liquidityUsd,
            volume_usd: { h24: volumeUsd },
            price_usd: priceUsd
          },
          relationships: {
            base_token: { data: { id: tokenAddress } },
            quote_token: { data: { id: quoteAddress } },
            dex: { data: { id: "nad-fun" } }
          },
          __baseTokenMeta: {
            attributes: {
              address: tokenAddress,
              symbol,
              decimals: 18
            }
          },
          __quoteTokenMeta: {
            attributes: {
              address: quoteAddress,
              symbol: quoteSymbol,
              decimals: assets.get(quoteAddress)?.decimals ?? 18
            }
          },
          __dexMeta: { id: "nad-fun" },
          __dexName: "nad.fun",
          __quoteKind: "unsupported",
          __priceUsd: priceUsd,
          __createdAtBlock: undefined
        });
      }
    } catch (error) {
      errors.push(
        "NadFun " +
        endpoint.key +
        ": " +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  return {
    pools: dedupePoolRecords(pools),
    assets: [...assets.values()],
    provider: {
      source: "nad.fun",
      network: "monad",
      requestsThisScan,
      poolCount: pools.length,
      discoveredTokenCount: Math.max(0, assets.size - assetMap().size),
      errors: errors.length ? errors : undefined
    }
  };
}

async function discoverDexPaprikaMonadPools(
  cache?: LSTArbitrageCache,
  apiKey?: string
) {
  const now = Date.now();
  const knownAssets = assetMap();
  const errors: string[] = [];
  const discoveredAssets = new Map<string, ArbitrageAsset>(knownAssets);
  let requestsThisScan = 0;
  let providerBlocked = false;
  let blockedUntil = 0;
  let pagesFetched = 0;
  let cachedPages = 0;

  // DexPaprika's Monad network index is currently public. Do not send a
  // possibly stale/invalid API key to the public endpoint: a bad credential can
  // turn a normally-available index into HTTP 402 and unnecessarily force the
  // much smaller fallback frontier.
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "geld-arbitrage/2.1"
  };

  const blockedEntry = await readCache<number>(cache, PROVIDER_BLOCK_KEY);
  const persistedBlockedUntil = Number(blockedEntry?.data ?? 0);
  if (Number.isFinite(persistedBlockedUntil) && persistedBlockedUntil > now) {
    blockedUntil = persistedBlockedUntil;
    providerBlocked = true;
  }

  const pageRows: any[] = [];
  let nextCursor = "";

  // Primary network-wide index. Four 100-row cursor pages provide broad coverage
  // without consuming the entire Worker subrequest budget.
  for (let page = 0; page < 4; page++) {
    const cacheKey =
      DEXPAPRIKA_CACHE_PREFIX + ":network-pools:page:" + page + ":v5";
    let pageData: any = null;
    const cached = await readEdgeCache<any>(cacheKey);

    if (cached && now - cached.fetchedAt < DEXPAPRIKA_CACHE_TTL_MS) {
      pageData = cached.data;
      cachedPages++;
    } else if (!providerBlocked) {
      const query = new URLSearchParams({
        order_by: "volume_usd_24h",
        sort: "desc",
        limit: "100",
        detailed: "true"
      });
      if (nextCursor) query.set("cursor", nextCursor);

      try {
        const result = await fetchProviderJson<any>(
          cacheKey,
          DEXPAPRIKA_BASE_URL + "/networks/" + DEXPAPRIKA_NETWORK + "/pools/search?" + query.toString(),
          headers,
          DEXPAPRIKA_CACHE_TTL_MS
        );
        pageData = result.data;
        if (!result.fromCache) {
          requestsThisScan++;
          pagesFetched++;
        } else {
          cachedPages++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        const status = Number(message.match(/HTTP (\\d+)/)?.[1] ?? 0);
        if (status === 402 || status === 429) {
          blockedUntil = now + PROVIDER_COOLDOWN_MS;
          providerBlocked = true;
          await writeCache(cache, PROVIDER_BLOCK_KEY, blockedUntil, now);
        }
        break;
      }
    }

    if (!pageData) break;
    const rows = Array.isArray(pageData?.results) ? pageData.results : [];
    if (!rows.length) break;
    pageRows.push(...rows);

    const hasNext =
      pageData?.has_next_page === true &&
      typeof pageData?.next_cursor === "string" &&
      pageData.next_cursor.length > 0;
    if (!hasNext) break;
    nextCursor = pageData.next_cursor;
  }

  // Register every token found in the primary pool index BEFORE the secondary
  // frontier runs. This lets the batched DexScreener crawl enrich newly discovered
  // tokens during the same scan instead of waiting for the next 30s refresh.
  for (const row of pageRows) {
    const tokens = Array.isArray(row?.tokens) ? row.tokens.slice(0, 2) : [];
    for (const token of tokens) {
      const tokenAddress = normalizeAssetAddress(
        tokenIdentifier(token) ??
        (token === tokens[0] ? row?.base_token_id : row?.quote_token_id)
      );
      if (!tokenAddress) continue;
      const known = discoveredAssets.get(tokenAddress);
      if (!known) {
        discoveredAssets.set(tokenAddress, {
          symbol: tokenSymbol(
            token,
            "TKN_" + tokenAddress.slice(2, 8).toUpperCase()
          ),
          address: tokenAddress,
          decimals: tokenDecimals(token, 18)
        });
      }
    }
  }

  // NadFun is a first-class Monad token source rather than an LST-only
  // special case. Pull both the highest-cap and newest token pages so meme
  // tokens enter the same arbitrage universe before DEX enrichment.
  const nadfunBudget = Math.min(2, Math.max(0, 8 - requestsThisScan));
  const nadfun = nadfunBudget > 0
    ? await discoverNadfunMonadTokens(cache, nadfunBudget)
    : {
        pools: [] as any[],
        assets: [] as ArbitrageAsset[],
        provider: {
          source: "nad.fun",
          network: "monad",
          requestsThisScan: 0,
          poolCount: 0,
          errors: undefined as string[] | undefined
        }
      };

  for (const asset of nadfun.assets ?? []) {
    discoveredAssets.set(asset.address.toLowerCase(), asset);
  }

  // Always augment the primary index with dynamic token-address frontiers.
  // Newly discovered addresses are queued and can be batched (up to 30/request)
  // so the dashboard is not limited to the static seed list.
  const remainingDiscoveryBudget = Math.max(
    0,
    8 - requestsThisScan - Number(nadfun.provider?.requestsThisScan ?? 0)
  );
  const frontier = remainingDiscoveryBudget > 0
    ? await discoverDexScreenerMonadPools(cache, remainingDiscoveryBudget, discoveredAssets)
    : {
        pools: [] as any[],
        assets: [...discoveredAssets.values()],
        provider: {
          source: "dexscreener-frontier",
          network: "monad",
          requestsThisScan: 0,
          refreshedAssets: [] as string[],
          cachedAssets: [] as string[],
          blockedUntil: null as number | null,
          errors: undefined as string[] | undefined,
          availableDexes: [] as string[]
        }
      };

  for (const asset of frontier.assets ?? []) {
    discoveredAssets.set(asset.address.toLowerCase(), asset);
  }

  const parsedDexPaprika = new Map<string, any>();
  for (const row of pageRows) {
    const tokens = Array.isArray(row?.tokens) ? row.tokens.slice(0, 2) : [];
    if (tokens.length < 2) continue;

    const token0 = normalizeAssetAddress(
      tokenIdentifier(tokens[0]) || row?.base_token_id
    );
    const token1 = normalizeAssetAddress(
      tokenIdentifier(tokens[1]) || row?.quote_token_id
    );
    if (!token0 || !token1 || token0 === token1) continue;

    const baseMeta = tokens[0] ?? {};
    const quoteMeta = tokens[1] ?? {};
    const baseAsset = knownAssets.get(token0) ?? discoveredAssets.get(token0) ?? {
      symbol: tokenSymbol(baseMeta, "TKN_" + token0.slice(2, 8).toUpperCase()),
      address: token0,
      decimals: tokenDecimals(baseMeta, 18)
    };
    const quoteAsset = knownAssets.get(token1) ?? discoveredAssets.get(token1) ?? {
      symbol: tokenSymbol(quoteMeta, "TKN_" + token1.slice(2, 8).toUpperCase()),
      address: token1,
      decimals: tokenDecimals(quoteMeta, 18)
    };
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
    if (!poolAddress) continue;

    const baseToQuote =
      num(row?.base_token_price_quote_token) ||
      num(row?.last_price) ||
      1;

    parsedDexPaprika.set(poolAddress.toLowerCase(), {
      id: String(row?.id ?? poolAddress),
      attributes: {
        address: poolAddress,
        name:
          tokenSymbol(baseMeta, baseAsset.symbol) + "/" +
          tokenSymbol(quoteMeta, quoteAsset.symbol) + " " +
          String(row?.dex_name ?? row?.dex_id ?? "dex"),
        base_token_price_quote_token: String(baseToQuote),
        pool_fee_percentage: num(row?.fee),
        reserve_in_usd: num(row?.liquidity_usd),
        volume_usd: { h24: num(row?.volume_usd_24h) },
        price_usd: num(row?.price_usd)
      },
      relationships: {
        base_token: { data: { id: token0 } },
        quote_token: { data: { id: token1 } },
        dex: { data: { id: dexId } }
      },
      __baseTokenMeta: {
        attributes: {
          address: token0,
          symbol: tokenSymbol(baseMeta, baseAsset.symbol),
          decimals: tokenDecimals(baseMeta, baseAsset.decimals)
        }
      },
      __quoteTokenMeta: {
        attributes: {
          address: token1,
          symbol: tokenSymbol(quoteMeta, quoteAsset.symbol),
          decimals: tokenDecimals(quoteMeta, quoteAsset.decimals)
        }
      },
      __dexMeta: { id: dexId },
      __dexName: String(row?.dex_name ?? dexId),
      __quoteKind: quoteKind,
      __createdAtBlock: row?.created_at_block_number,
      __priceUsd: num(row?.price_usd)
    });
  }

  const combinedPools = dedupePoolRecords([
    ...parsedDexPaprika.values(),
    ...(nadfun.pools ?? []),
    ...(frontier.pools ?? [])
  ]);
  const combinedDexes = [...new Set(
    combinedPools
      .map(pool => String(pool?.__dexMeta?.id ?? "").toLowerCase())
      .filter(Boolean)
  )].sort();

  return {
    pools: combinedPools,
    assets: [...discoveredAssets.values()],
    provider: {
      source: "dexpaprika+dexscreener",
      network: DEXPAPRIKA_NETWORK,
      requestsThisScan:
        requestsThisScan +
        Number(nadfun.provider?.requestsThisScan ?? 0) +
        Number(frontier.provider?.requestsThisScan ?? 0),
      assetQueries: 0,
      assetLimit: Number(discoveredAssets.size),
      refreshedAssets: [
        ...(pagesFetched > 0 ? ["NETWORK"] : []),
        ...(nadfun.provider?.requestsThisScan ? ["NADFUN"] : []),
        ...(frontier.provider?.refreshedAssets ?? [])
      ],
      cachedAssets: [
        "NETWORK_PAGES:" + cachedPages,
        ...(frontier.provider?.cachedAssets ?? [])
      ],
      pageCount: pageRows.length,
      pagesFetched,
      cachedPages,
      blockedUntil: blockedUntil > now ? blockedUntil : null,
      cacheTtlMs: DEXPAPRIKA_CACHE_TTL_MS,
      availableDexes: combinedDexes,
      fallbackUsed:
        Number(frontier.provider?.requestsThisScan ?? 0) > 0 ||
        (frontier.pools?.length ?? 0) > 0,
      fallbackSource: frontier.provider?.source,
      fallbackRequestsThisScan: Number(frontier.provider?.requestsThisScan ?? 0),
      fallbackRefreshedAssets: frontier.provider?.refreshedAssets ?? [],
      fallbackCachedAssets: frontier.provider?.cachedAssets ?? [],
      fallbackAvailableDexes: frontier.provider?.availableDexes ?? [],
      fallbackErrors: [
        ...(nadfun.provider?.errors ?? []),
        ...(frontier.provider?.errors ?? [])
      ].length
        ? [...new Set([
            ...(nadfun.provider?.errors ?? []),
            ...(frontier.provider?.errors ?? [])
          ])]
        : undefined,
      nadfunRequestsThisScan: Number(nadfun.provider?.requestsThisScan ?? 0),
      nadfunPoolCount: Number(nadfun.provider?.poolCount ?? 0),
      errors: errors.length
        ? [...new Set(errors.concat(nadfun.provider?.errors ?? [], frontier.provider?.errors ?? []))]
        : [
            ...(nadfun.provider?.errors ?? []),
            ...(frontier.provider?.errors ?? [])
          ].length
          ? [...new Set([
              ...(nadfun.provider?.errors ?? []),
              ...(frontier.provider?.errors ?? [])
            ])]
          : frontier.provider?.errors,
      note:
        "Network discovery combines the indexed Monad pool universe, NadFun's meme-token universe, and a batched DexScreener token frontier. " +
        "Every token found in any source enters the dynamic universe; exact on-chain quotes remain the profitability gate."
    }
  };
}
function dedupePoolRecords(pools: any[]) {
  const deduped = new Map<string, any>();
  for (const pool of pools) {
    const key = String(pool?.attributes?.address ?? pool?.id ?? "").toLowerCase();
    if (!key) continue;
    const existing = deduped.get(key);
    if (!existing ||
        num(pool?.attributes?.liquidity_usd) > num(existing?.attributes?.liquidity_usd)) {
      deduped.set(key, pool);
    }
  }
  return [...deduped.values()];
}

async function discoverDexScreenerMonadPools(
  cache: LSTArbitrageCache | undefined,
  maxRequests: number,
  availableAssets?: Map<string, ArbitrageAsset>
) {
  const assets = availableAssets ? new Map(availableAssets) : assetMap();
  const pools: any[] = [];
  const refreshedAssets: string[] = [];
  const cachedAssets: string[] = [];
  const errors: string[] = [];
  const now = Date.now();
  const queue: string[] = [];
  const queued = new Set<string>();
  const queried = new Set<string>();
  let requestsThisScan = 0;
  let latestProfileCount = 0;
  let latestProfileRequests = 0;
  let latestBoostCount = 0;
  let latestBoostRequests = 0;
  let queriedTokenCount = 0;
  let frontierStartIndex = 0;
  let searchCursor = 0;
  let searchQueries: string[] = [];
  let searchRequests = 0;

  const blockedEntry = await readCache<number>(cache, DEXSCREENER_BLOCK_KEY);
  const persistedBlockedUntil = Number(blockedEntry?.data ?? 0);
  if (Number.isFinite(persistedBlockedUntil) && persistedBlockedUntil > now) {
    return {
      pools: [],
      assets: [...assets.values()],
      provider: {
        source: "dexscreener-frontier",
        network: "monad",
        requestsThisScan: 0,
        refreshedAssets,
        cachedAssets,
        blockedUntil: persistedBlockedUntil,
        errors: ["DexScreener cooldown active"],
        availableDexes: []
      }
    };
  }

  // The reliable high-volume discovery source on Monad is now the token-address
  // frontier. Search/profile/boost feeds are global and have repeatedly returned
  // HTTP 429s without improving Monad coverage, so discovery spends its limited
  // request budget on batched Monad token-pair lookups instead.
  const discoveryBudget = Math.max(0, Math.floor(maxRequests));
  // Rotate through the complete known/discovered token universe instead of
  // repeatedly refreshing the first 180-240 addresses. The cursor lives in the
  // edge cache so it survives Worker isolate churn without consuming DO storage.
  const frontierAddresses = [...new Set(
    [...assets.keys()].map(address => address.toLowerCase())
  )].sort();

  if (frontierAddresses.length) {
    const cursorEntry = await readEdgeCache<number>(DEXSCREENER_FRONTIER_CURSOR_KEY);
    const storedCursor = Number(cursorEntry?.data ?? 0);
    frontierStartIndex =
      Number.isFinite(storedCursor) && storedCursor >= 0
        ? Math.floor(storedCursor) % frontierAddresses.length
        : 0;

    for (let offset = 0; offset < frontierAddresses.length; offset++) {
      const index = (frontierStartIndex + offset) % frontierAddresses.length;
      const address = frontierAddresses[index];
      if (!queued.has(address)) {
        queue.push(address);
        queued.add(address);
      }
    }
  }

  // DEX Screener accepts up to 30 token addresses in the multi-token endpoint.
  // A batch is therefore much more efficient than one HTTP request per token.
  const MAX_BATCH_TOKENS = 30;

  while (requestsThisScan < Math.max(0, Math.floor(maxRequests)) && queue.length > 0) {
    const batch: string[] = [];

    while (batch.length < MAX_BATCH_TOKENS && queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate || queried.has(candidate)) continue;
      queried.add(candidate);
      batch.push(candidate);
    }
    if (!batch.length) continue;

    const cacheKey =
      "lst-arb:dexscreener:tokens:" + batch.join(",") + ":v4";
    let rows: any[] = [];

    try {
      queriedTokenCount += batch.length;
      const result = await fetchProviderJson<any[]>(
        cacheKey,
        DEXSCREENER_BASE_URL + "/tokens/v1/monad/" + batch.join(","),
        { accept: "application/json", "user-agent": "geld-arbitrage/2.1" },
        DEXSCREENER_CACHE_TTL_MS
      );

      rows = Array.isArray(result.data) ? result.data : [];
      if (!result.fromCache) {
        requestsThisScan++;
        refreshedAssets.push(...batch);
      } else {
        cachedAssets.push(...batch);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      const status = Number(message.match(/HTTP (\\d+)/)?.[1] ?? 0);
      if (status === 402 || status === 429) {
        const retryUntil = now + PROVIDER_COOLDOWN_MS;
        await writeCache(cache, DEXSCREENER_BLOCK_KEY, retryUntil, now);
        break;
      }
      continue;
    }

    for (const row of rows) {
      const base = normalizeAssetAddress(row?.baseToken?.address);
      const quote = normalizeAssetAddress(row?.quoteToken?.address);
      if (!base || !quote || base === quote) continue;

      const baseAsset = assets.get(base) ?? {
        symbol: String(row?.baseToken?.symbol ?? ("TKN_" + base.slice(2, 8).toUpperCase())),
        address: base,
        decimals: Number(row?.baseToken?.decimals ?? 18)
      };
      const quoteAsset = assets.get(quote) ?? {
        symbol: String(row?.quoteToken?.symbol ?? ("TKN_" + quote.slice(2, 8).toUpperCase())),
        address: quote,
        decimals: Number(row?.quoteToken?.decimals ?? 18)
      };

      if (!assets.has(base)) {
        assets.set(base, baseAsset);
        if (!queried.has(base) && !queued.has(base)) {
          queue.push(base);
          queued.add(base);
        }
      }
      if (!assets.has(quote)) {
        assets.set(quote, quoteAsset);
        if (!queried.has(quote) && !queued.has(quote)) {
          queue.push(quote);
          queued.add(quote);
        }
      }

      const dex = String(row?.dexId ?? "").toLowerCase();
      const labels = Array.isArray(row?.labels)
        ? row.labels.map((x: unknown) => String(x).toLowerCase())
        : [];

      let quoteKind: QuoteKind = "unsupported";
      if (dex === "uniswap" && labels.includes("v3")) quoteKind = "uniswap-v3";
      else if (dex === "uniswap" && labels.includes("v2")) quoteKind = "uniswap-v2";
      else if (dex === "pancakeswap" && labels.includes("v3")) quoteKind = "pancake-v3";
      else if (dex === "pancakeswap" && labels.includes("v2")) quoteKind = "pancake-v2";

      const poolAddress = addr(row?.pairAddress);
      if (!poolAddress) continue;

      const priceNative = num(row?.priceNative);
      const baseToQuote = priceNative > 0 ? priceNative : 1;
      const baseUsd = num(row?.priceUsd);

      pools.push({
        id: poolAddress,
        attributes: {
          address: poolAddress,
          name:
            baseAsset.symbol + "/" + quoteAsset.symbol + " " +
            dex + (labels.length ? " " + labels.join("/") : ""),
          base_token_price_quote_token: String(baseToQuote),
          pool_fee_percentage: 0,
          reserve_in_usd: num(row?.liquidity?.usd),
          volume_usd: { h24: num(row?.volume?.h24) },
          price_usd: baseUsd
        },
        relationships: {
          base_token: { data: { id: base } },
          quote_token: { data: { id: quote } },
          dex: { data: { id: dex } }
        },
        __baseTokenMeta: {
          attributes: {
            address: base,
            symbol: String(row?.baseToken?.symbol ?? baseAsset.symbol),
            decimals: Number(row?.baseToken?.decimals ?? baseAsset.decimals)
          }
        },
        __quoteTokenMeta: {
          attributes: {
            address: quote,
            symbol: String(row?.quoteToken?.symbol ?? quoteAsset.symbol),
            decimals: Number(row?.quoteToken?.decimals ?? quoteAsset.decimals)
          }
        },
        __dexMeta: { id: dex },
        __quoteKind: quoteKind,
        __priceUsd: baseUsd
      });
    }
  }

  const deduped = dedupePoolRecords(pools);
  if (frontierAddresses.length && queriedTokenCount > 0) {
    await writeEdgeCache(
      DEXSCREENER_FRONTIER_CURSOR_KEY,
      frontierStartIndex + queriedTokenCount,
      now
    );
  }

  return {
    pools: deduped,
    assets: [...assets.values()],
    provider: {
      source: "dexscreener-frontier",
      network: "monad",
      requestsThisScan,
      latestProfileCount: 0,
      latestProfileRequests: 0,
      latestBoostCount: 0,
      latestBoostRequests: 0,
      searchQueries,
      searchRequests,
      queriedTokenCount,
      frontierStartIndex,
      frontierUniverseSize: frontierAddresses.length,
      coverageMode: "rotating-token-address-frontier",
      refreshedAssets,
      cachedAssets,
      blockedUntil: null,
      errors: errors.length ? [...new Set(errors)] : undefined,
      availableDexes: [...new Set(
        deduped.map(pool => String(pool?.__dexMeta?.id ?? "").toLowerCase()).filter(Boolean)
      )].sort()
    }
  };
}

function kuruAssetBySymbol(symbol: string, assets: Map<string, ArbitrageAsset>) {
  const upper = symbol.toUpperCase();
  if (upper === "MON") {
    return assets.get("0x3bd359c1119da7da1d913d1c4d2b7c461115433a") ?? null;
  }
  for (const asset of assets.values()) {
    if (asset.symbol.toUpperCase() === upper) return asset;
  }
  return null;
}

async function discoverKuruMarkets(
  cache?: LSTArbitrageCache,
  availableAssets?: Map<string, ArbitrageAsset>
) {
  const cacheKey = "geld-lst-arb-v6:kuru:exchange-info";
  const errors: string[] = [];
  try {
    const result = await fetchProviderJson<any>(
      cacheKey,
      KURU_EXCHANGE_INFO_URL,
      {
        accept: "application/json",
        "user-agent": "geld-lst-arbitrage/1.0"
      },
      DEXPAPRIKA_CACHE_TTL_MS
    );

    const rows = Array.isArray(result.data?.symbols) ? result.data.symbols : [];
    const assets = availableAssets ? new Map(availableAssets) : assetMap();
    const pools: any[] = [];

    for (const market of rows) {
      if (String(market?.status ?? "").toUpperCase() !== "TRADING") continue;

      const baseAddress = normalizeAssetAddress(
        market?.baseAssetAddress ??
        market?.baseTokenAddress ??
        market?.baseAddress ??
        ""
      );
      const quoteAddress = normalizeAssetAddress(
        market?.quoteAssetAddress ??
        market?.quoteTokenAddress ??
        market?.quoteAddress ??
        ""
      );
      const baseSymbol = String(market?.baseAsset ?? "").trim() || "TKN_" + baseAddress.slice(2, 8).toUpperCase();
      const quoteSymbol = String(market?.quoteAsset ?? "").trim() || "TKN_" + quoteAddress.slice(2, 8).toUpperCase();

      const baseAsset =
        (baseAddress && assets.get(baseAddress)) ??
        (baseAddress
          ? {
              symbol: baseSymbol.toUpperCase() === "MON" ? "WMON" : baseSymbol,
              address: baseAddress,
              decimals: Number(market?.baseAssetDecimals ?? 18)
            }
          : kuruAssetBySymbol(baseSymbol, assets));

      const quoteAsset =
        (quoteAddress && assets.get(quoteAddress)) ??
        (quoteAddress
          ? {
              symbol: quoteSymbol.toUpperCase() === "MON" ? "WMON" : quoteSymbol,
              address: quoteAddress,
              decimals: Number(market?.quoteAssetDecimals ?? 18)
            }
          : kuruAssetBySymbol(quoteSymbol, assets));

      if (baseAsset) assets.set(baseAsset.address.toLowerCase(), baseAsset);
      if (quoteAsset) assets.set(quoteAsset.address.toLowerCase(), quoteAsset);

      const marketAddress = addr(market?.marketAddress);

      if (!baseAsset || !quoteAsset || !marketAddress || baseAsset.address.toLowerCase() === quoteAsset.address.toLowerCase()) {
        continue;
      }

      const kuruMarket: KuruMarket = {
        symbol: String(market.symbol),
        status: String(market.status),
        marketAddress,
        baseAsset: String(market.baseAsset),
        quoteAsset: String(market.quoteAsset),
        baseAssetAddress: baseAsset.address.toLowerCase(),
        quoteAssetAddress: quoteAsset.address.toLowerCase(),
        baseAssetPrecision: Number(market.baseAssetDecimals ?? baseAsset.decimals),
        quoteAssetPrecision: Number(market.quoteAssetDecimals ?? quoteAsset.decimals),
        pricePrecision: Number(market.pricePrecision ?? 0),
        sizePrecision: String(market.sizePrecision ?? "0"),
        tickSize: String(market.tickSize ?? "0"),
        minSize: String(market.minSize ?? "0"),
        maxSize: String(market.maxSize ?? "0"),
        takerFeeBps: Number(market.takerFeeBps ?? 0),
        makerFeeBps: Number(market.makerFeeBps ?? 0)
      };

      if (!(kuruMarket.pricePrecision > 0 && BigInt(kuruMarket.sizePrecision) > 0n)) continue;

      pools.push({
        id: marketAddress,
        attributes: {
          address: marketAddress,
          name: `${baseAsset.symbol}/${quoteAsset.symbol} Kuru ${kuruMarket.symbol}`,
          // Neutral theoretical rate. Kuru is explicitly reserved for an exact
          // probe, so discovery data cannot cause us to trade on a fake edge.
          base_token_price_quote_token: "1",
          pool_fee_percentage: kuruMarket.takerFeeBps / 100,
          reserve_in_usd: 1,
          volume_usd: { h24: 0 }
        },
        relationships: {
          base_token: { data: { id: baseAsset.address } },
          quote_token: { data: { id: quoteAsset.address } },
          dex: { data: { id: "kuru" } }
        },
        __baseTokenMeta: {
          attributes: {
            address: baseAsset.address,
            symbol: baseAsset.symbol,
            decimals: baseAsset.decimals
          }
        },
        __quoteTokenMeta: {
          attributes: {
            address: quoteAsset.address,
            symbol: quoteAsset.symbol,
            decimals: quoteAsset.decimals
          }
        },
        __dexMeta: { id: "kuru" },
        __quoteKind: "kuru",
        __kuruMarket: kuruMarket
      });
    }

    return {
      pools,
      assets: [...assets.values()],
      provider: {
        source: "kuru",
        network: "monad",
        requestsThisScan: result.fromCache ? 0 : 1,
        cached: result.fromCache,
        marketCount: pools.length,
        availableDexes: pools.length ? ["kuru"] : [],
        errors: undefined
      }
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return {
      pools: [],
      assets: availableAssets ? [...availableAssets.values()] : [...assetMap().values()],
      provider: {
        source: "kuru",
        network: "monad",
        requestsThisScan: 1,
        cached: false,
        marketCount: 0,
        availableDexes: [],
        errors
      }
    };
  }
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
    priceUsd: num(record?.__priceUsd ?? a?.price_usd),
    dex,
    quoteKind: record?.__quoteKind && record.__quoteKind !== "unsupported" ? record.__quoteKind : classifyQuoteKind(poolAddress, dex),
    createdAtBlock: record?.__createdAtBlock ? String(record.__createdAtBlock) : undefined,
    kuruMarket: record?.__kuruMarket
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
    kind === "kuru" ||
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
    createdAtBlock: pool.createdAtBlock,
    kuruMarket: pool.kuruMarket
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
    createdAtBlock: pool.createdAtBlock,
    kuruMarket: pool.kuruMarket
  });
}


export type ArbitragePotentialToken = {
  symbol: string;
  address: string;
  decimals: number;
  poolCount: number;
  venueCount: number;
  venues: string[];
  maxLiquidityUsd: number;
  totalLiquidityUsd: number;
  volume24hUsd: number;
  priceSpreadPct: number | null;
  exactSupportedVenueCount: number;
  exactSupported: boolean;
  potential: boolean;
  reason: string[];
  score: number;
};

function buildArbitragePotentialTokens(
  pools: PoolRecord[],
  assets: Map<string, ArbitrageAsset>,
  cycleTokenAddresses = new Set<string>()
): ArbitragePotentialToken[] {
  const byToken = new Map<string, {
    poolCount: number;
    venues: Set<string>;
    liquidity: number[];
    volume24hUsd: number;
    prices: number[];
    exactVenues: Set<string>;
  }>();

  const supportedKinds = new Set<QuoteKind>([
    "kuru",
    "curve-lst",
    "uniswap-v4",
    "uniswap-v3",
    "uniswap-v2",
    "pancake-v3",
    "pancake-v2"
  ]);

  for (const pool of pools) {
    const basePrice = Number(pool.priceUsd ?? 0);
    const derivedQuotePrice =
      Number.isFinite(basePrice) &&
      basePrice > 0 &&
      pool.baseToQuote > 0
        ? basePrice / pool.baseToQuote
        : undefined;

    const tokenEntries = [
      { address: pool.base, price: basePrice > 0 ? basePrice : undefined },
      { address: pool.quote, price: derivedQuotePrice }
    ];

    for (const entry of tokenEntries) {
      const token = entry.address.toLowerCase();
      const row = byToken.get(token) ?? {
        poolCount: 0,
        venues: new Set<string>(),
        liquidity: [],
        volume24hUsd: 0,
        prices: [],
        exactVenues: new Set<string>()
      };

      row.poolCount++;
      row.venues.add(pool.dex.toLowerCase());
      row.liquidity.push(Math.max(0, pool.liquidityUsd));
      row.volume24hUsd += Math.max(0, pool.volume24hUsd);
      if (entry.price && entry.price > 0) row.prices.push(entry.price);
      if (supportedKinds.has(pool.quoteKind)) {
        row.exactVenues.add(pool.dex.toLowerCase());
      }
      byToken.set(token, row);
    }
  }

  const out: ArbitragePotentialToken[] = [];
  for (const [address, row] of byToken) {
    const asset = assets.get(address) ?? dynamicAsset(address, assets);
    const prices = row.prices.filter(x => Number.isFinite(x) && x > 0);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const spread =
      minPrice > 0 && maxPrice > 0
        ? (maxPrice / minPrice - 1) * 100
        : null;

    const reasons: string[] = [];
    if (row.venues.size >= 2) reasons.push("multi-venue");
    if (row.poolCount >= 2) reasons.push("multi-pool");
    if (spread !== null && spread >= MIN_GROSS_EDGE_PCT) reasons.push("price-divergence");
    if (row.exactVenues.size >= 2) reasons.push("multi-venue-exact");
    if (cycleTokenAddresses.has(address)) reasons.push("cycle-topology");
    if (!reasons.length) continue;

    const maxLiquidityUsd = Math.max(...row.liquidity, 0);
    const totalLiquidityUsd = row.liquidity.reduce((sum, value) => sum + value, 0);
    const potential =
      row.venues.size >= 2 ||
      (spread !== null && spread >= MIN_GROSS_EDGE_PCT);
    const score =
      row.venues.size * 30 +
      Math.min(row.poolCount, 10) * 4 +
      Math.min(maxLiquidityUsd / 10_000, 50) +
      Math.min(row.volume24hUsd / 100_000, 30) +
      Math.min(Math.max(spread ?? 0, 0), 100);

    out.push({
      symbol: asset.symbol,
      address,
      decimals: asset.decimals,
      poolCount: row.poolCount,
      venueCount: row.venues.size,
      venues: [...row.venues].sort(),
      maxLiquidityUsd,
      totalLiquidityUsd,
      volume24hUsd: row.volume24hUsd,
      priceSpreadPct: spread,
      exactSupportedVenueCount: row.exactVenues.size,
      exactSupported: row.exactVenues.size > 0,
      potential,
      reason: reasons,
      score
    });
  }

  return out
    .filter(item => item.potential)
    .sort((a, b) =>
      (b.score - a.score) ||
      (b.venueCount - a.venueCount) ||
      (b.maxLiquidityUsd - a.maxLiquidityUsd)
    );
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
async function fetchKyberRouteFresh(tokenIn: string, tokenOut: string, amountIn: string) {
  const url = KYBER_BASE_URL + "/monad/api/v1/routes?tokenIn=" + encodeURIComponent(tokenIn) +
    "&tokenOut=" + encodeURIComponent(tokenOut) + "&amountIn=" + encodeURIComponent(amountIn) + "&gasInclude=true";
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "geld-arbitrage/1.0", "x-client-id": KYBER_CLIENT_ID }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Kyber route HTTP " + response.status + ": " + String((body as any)?.message ?? "unknown error"));
  const routeSummary = (body as any)?.data?.routeSummary;
  if (!routeSummary) throw new Error("Kyber route unavailable: " + String((body as any)?.message ?? "missing routeSummary"));
  return { routeSummary, routerAddress: String((body as any)?.data?.routerAddress ?? "") };
}

async function buildKyberRouteFresh(routeSummary: any, sender: string, recipient: string, deadline: number, slippageTolerance = KYBER_SIMULATION_SLIPPAGE_BPS) {
  const response = await fetch(KYBER_BASE_URL + "/monad/api/v1/route/build", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "geld-arbitrage/1.0", "x-client-id": KYBER_CLIENT_ID },
    body: JSON.stringify({ routeSummary, sender, origin: sender, recipient, deadline, slippageTolerance, enableGasEstimation: true, source: "GELD" })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Kyber build HTTP " + response.status + ": " + String((body as any)?.message ?? "unknown error"));
  const data = (body as any)?.data;
  if (!data?.data || !data?.routerAddress) throw new Error("Kyber build unavailable: " + String((body as any)?.message ?? "missing calldata"));
  return data;
}

async function rpcJson(rpcUrl: string, method: string, params: unknown[] = []): Promise<any> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("RPC HTTP " + response.status);
  if ((body as any)?.error) throw new Error("RPC " + method + " error: " + String((body as any).error?.message ?? JSON.stringify((body as any).error)));
  return (body as any)?.result;
}

async function simulationSenderFromPrivateKey(sender?: string, privateKey?: string) {
  const explicit = addr(sender);
  if (explicit) return explicit;
  const key = String(privateKey ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Simulation requires a sender address or a configured MONAD_PRIVATE_KEY");
  const { privateKeyToAccount } = await import("viem/accounts");
  return privateKeyToAccount(key as `0x${string}`).address.toLowerCase();
}

function simulationAssetDecimals(address: string) {
  const asset = ARBITRAGE_ASSETS.find(a => a.address.toLowerCase() === address.toLowerCase());
  return asset?.decimals ?? 18;
}

function decodeCallManyResult(item: any) {
  if (item && typeof item === "object" && "error" in item) return { ok: false, error: item.error };
  if (typeof item === "string") return { ok: true, value: item };
  if (item && typeof item === "object" && typeof item.value === "string") return { ok: true, value: item.value };
  return { ok: false, error: item ?? "unknown simulation result" };
}

export async function preflightKyberRoundTrip(rpcUrl: string, targetAddress: string, sizeMon: number, sender?: string, privateKey?: string, slippageTolerance = KYBER_SIMULATION_SLIPPAGE_BPS) {
  if (!(sizeMon > 0)) throw new Error("sizeMon must be greater than zero");
  const target = addr(targetAddress);
  if (!target || target === addr(KYBER_NATIVE_TOKEN)) throw new Error("targetAddress must be a valid ERC-20 token address");
  const simulationSender = await simulationSenderFromPrivateKey(sender, privateKey);
  const amountInRaw = parseUnits(String(sizeMon), 18).toString();
  const deadline = Math.floor(Date.now() / 1000) + 120;

  const forward = await fetchKyberRouteFresh(KYBER_NATIVE_TOKEN, target, amountInRaw);
  const forwardOutRaw = String(forward.routeSummary?.amountOut ?? "");
  if (!/^\d+$/.test(forwardOutRaw) || BigInt(forwardOutRaw) <= 0n) throw new Error("Kyber forward route returned no output");
  const reverse = await fetchKyberRouteFresh(target, KYBER_NATIVE_TOKEN, forwardOutRaw);
  const [forwardBuild, reverseBuild] = await Promise.all([
    buildKyberRouteFresh(forward.routeSummary, simulationSender, simulationSender, deadline, slippageTolerance),
    buildKyberRouteFresh(reverse.routeSummary, simulationSender, simulationSender, deadline, slippageTolerance)
  ]);
  const reverseRouter = addr(reverseBuild.routerAddress);
  if (!reverseRouter) throw new Error("Kyber reverse build returned no router address");

  const allowanceCalldata = encodeFunctionData({
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [simulationSender as Address, reverseRouter as Address]
  });
  let allowance = 0n;
  try {
    const allowanceRaw = await rpcJson(rpcUrl, "eth_call", [{ to: target, data: allowanceCalldata }, "latest"]);
    allowance = BigInt(allowanceRaw);
  } catch {}

  const approvalNeeded = allowance < BigInt(forwardOutRaw);
  const transactions: any[] = [{
    from: simulationSender,
    to: addr(forwardBuild.routerAddress),
    value: "0x" + BigInt(String(forwardBuild.transactionValue ?? "0")).toString(16),
    input: String(forwardBuild.data),
    chainId: "0x8f"
  }];
  if (approvalNeeded) {
    const approveData = encodeFunctionData({
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "approve",
      args: [reverseRouter as Address, (2n ** 256n) - 1n]
    });
    transactions.push({ from: simulationSender, to: target, value: "0x0", input: approveData, chainId: "0x8f" });
  }
  transactions.push({
    from: simulationSender,
    to: reverseRouter,
    value: "0x" + BigInt(String(reverseBuild.transactionValue ?? "0")).toString(16),
    input: String(reverseBuild.data),
    chainId: "0x8f"
  });

  let blockNumber: string | null = null;
  let callMany: any = null;
  let callManyError: string | null = null;
  try {
    blockNumber = await rpcJson(rpcUrl, "eth_blockNumber");
    callMany = await rpcJson(rpcUrl, "eth_callMany", [[{ transactions }], { blockNumber, transactionIndex: 0 }, {}, 7000]);
  } catch (error) {
    callManyError = error instanceof Error ? error.message : String(error);
  }

  const simulatedTransactions = Array.isArray(callMany?.[0]) ? callMany[0].map(decodeCallManyResult) : [];
  const successfulSimulation = simulatedTransactions.length === transactions.length && simulatedTransactions.every((result: any) => result.ok === true);
  const quotedFinalMon = Number(String(reverse.routeSummary?.amountOut ?? "0")) / 1e18;
  const grossProfitMon = quotedFinalMon - sizeMon;
  const buildGas = transactions.map((_, index) => {
    const build = index === 0 ? forwardBuild : approvalNeeded && index === 1 ? null : reverseBuild;
    return build?.gas ? BigInt(String(build.gas)) : 0n;
  });
  const gasPriceRaw = await rpcJson(rpcUrl, "eth_gasPrice").catch(() => "0x0");
  const gasPrice = BigInt(String(gasPriceRaw));
  const totalGas = buildGas.reduce((sum, value) => sum + value, 0n);
  const gasCostMon = Number(totalGas * gasPrice) / 1e18;
  const netProfitMon = quotedFinalMon - sizeMon - gasCostMon - GAS_BUFFER_MON;

  return {
    mode: "PAPER_PREFLIGHT",
    provider: "kyberswap",
    chainId: 143,
    sender: simulationSender,
    target,
    targetDecimals: simulationAssetDecimals(target),
    sizeMon,
    amountInRaw,
    quotedIntermediateRaw: forwardOutRaw,
    quotedFinalMon,
    grossProfitMon,
    gasPriceRaw: gasPrice.toString(),
    gasUnits: totalGas.toString(),
    gasCostMon,
    gasBufferMon: GAS_BUFFER_MON,
    netProfitMon,
    candidate: successfulSimulation && netProfitMon >= MIN_NET_PROFIT_MON,
    atomic: false,
    executable: false,
    approval: { spender: reverseRouter, currentAllowanceRaw: allowance.toString(), requiredRaw: forwardOutRaw, needed: approvalNeeded, approvalWasSimulated: approvalNeeded },
    route: {
      forward: { tokenIn: KYBER_NATIVE_TOKEN, tokenOut: target, routeSummary: forward.routeSummary, build: forwardBuild },
      reverse: { tokenIn: target, tokenOut: KYBER_NATIVE_TOKEN, routeSummary: reverse.routeSummary, build: reverseBuild }
    },
    simulation: { method: "eth_callMany", blockNumber, transactionCount: transactions.length, transactions, results: simulatedTransactions, successful: successfulSimulation, error: callManyError },
    safety: { broadcasted: false, liveExecutionEnabled: false, requiresAtomicExecutor: true, note: "The sequence is simulated only. Approval, if required, exists only inside the simulation and is not sent to the chain." }
  };
}

function hexValue(value: bigint) {
  return "0x" + value.toString(16);
}

function txFrom(to: string, input: string, value = 0n, from: string) {
  return {
    from,
    to,
    value: hexValue(value),
    input,
    chainId: "0x8f"
  };
}

function minOutWithBuffer(amountOutRaw: string) {
  const amount = BigInt(amountOutRaw);
  return amount * (10_000n - BigInt(EXECUTION_BUFFER_BPS)) / 10_000n;
}

function universalRouterForQuoteKind(kind: QuoteKind) {
  if (kind === "uniswap-v3" || kind === "uniswap-v2") return UNISWAP_UNIVERSAL_ROUTER;
  if (kind === "pancake-v3" || kind === "pancake-v2") return PANCAKE_UNIVERSAL_ROUTER;
  return null;
}

function curveIndexes(edge: any) {
  const indexByAddress: Record<string, number> = {
    "0x3bd359c1119da7da1d913d1c4d2b7c461115433a": 0,
    "0x1b68626dca36c7fe922fd2d55e4f631d962de19c": 1,
    "0xa3227c5969757783154c60bf0bc1944180ed81b9": 2,
    "0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081": 3
  };
  const i = indexByAddress[String(edge.tokenIn ?? edge.from).toLowerCase()];
  const j = indexByAddress[String(edge.tokenOut ?? edge.to).toLowerCase()];
  return i === undefined || j === undefined ? null : { i, j };
}

function buildUniversalRouterExecute(
  router: Address,
  edge: any,
  amountIn: bigint,
  minOut: bigint,
  sender: string,
  deadline: number,
  nativeInput: boolean
) {
  const commands: string[] = [];
  const inputs: string[] = [];
  const tokenIn = String(edge.tokenIn ?? edge.from).toLowerCase() as Address;
  const tokenOut = String(edge.tokenOut ?? edge.to).toLowerCase() as Address;

  if (nativeInput) {
    commands.push("0x0b");
    inputs.push(encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [router, amountIn]
    ));
  }

  if (edge.quoteKind === "uniswap-v3" || edge.quoteKind === "pancake-v3") {
    const feeBps = Number(edge.feeBps ?? 0);
    const fee = feeBps > 0 ? Math.round(feeBps * 100) : Math.max(1, Math.round(Number(edge.feePct ?? 0) * 10_000));
    if (!(fee > 0 && fee <= 1_000_000)) {
      throw new Error("Invalid V3 fee for " + edge.venue);
    }
    const path = encodePacked(
      ["address", "uint24", "address"],
      [tokenIn, fee, tokenOut]
    );
    commands.push("0x00");
    inputs.push(encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes" },
        { type: "bool" },
        { type: "uint256[]" }
      ],
      [router, amountIn, minOut, path, false, []]
    ));
  } else if (edge.quoteKind === "uniswap-v2" || edge.quoteKind === "pancake-v2") {
    commands.push("0x08");
    inputs.push(encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address[]" },
        { type: "bool" },
        { type: "uint256[]" }
      ],
      [router, amountIn, minOut, [tokenIn, tokenOut], false, []]
    ));
  } else {
    throw new Error("Universal Router unsupported quote kind: " + edge.quoteKind);
  }

  commands.push("0x04");
  inputs.push(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [tokenOut, sender as Address, minOut]
  ));

  return encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: "execute",
    args: [("0x" + commands.map(x => x.slice(2)).join("")) as `0x${string}`, inputs as `0x${string}`[], BigInt(deadline)]
  });
}

function buildCurveExchange(edge: any, amountIn: bigint, minOut: bigint, sender: string) {
  const indexes = curveIndexes(edge);
  if (!indexes) throw new Error("Curve indexes unavailable for " + edge.from + "->" + edge.to);
  return encodeFunctionData({
    abi: CURVE_SWAP_ABI,
    functionName: "exchange",
    args: [BigInt(indexes.i), BigInt(indexes.j), amountIn, minOut, sender as Address]
  });
}

function buildKuruCall(edge: any, amountIn: bigint, minOut: bigint) {
  const market = edge.kuruMarket;
  if (!market) throw new Error("Kuru market metadata unavailable");

  const tokenIn = String(edge.tokenIn ?? edge.from).toLowerCase();
  const fromIsBase = tokenIn === market.baseAssetAddress.toLowerCase();
  const fromIsQuote = tokenIn === market.quoteAssetAddress.toLowerCase();
  if (!fromIsBase && !fromIsQuote) throw new Error("Kuru edge token mismatch");

  const inputDecimals = fromIsBase ? market.baseAssetPrecision : market.quoteAssetPrecision;
  const precision = fromIsBase ? BigInt(market.sizePrecision) : BigInt(market.pricePrecision);
  const marketSize = amountIn * precision / (10n ** BigInt(inputDecimals));
  const nativeInput =
    (fromIsBase && String(market.baseAsset).toUpperCase() === "MON") ||
    (fromIsQuote && String(market.quoteAsset).toUpperCase() === "MON");

  const input = fromIsBase
    ? encodeFunctionData({
        abi: KURU_MARKET_ABI,
        functionName: "placeAndExecuteMarketSell",
        args: [marketSize, minOut, false, true]
      })
    : encodeFunctionData({
        abi: KURU_MARKET_ABI,
        functionName: "placeAndExecuteMarketBuy",
        args: [marketSize, minOut, false, true]
      });

  return {
    input,
    value: nativeInput ? amountIn : 0n,
    nativeInput,
    marketAddress: market.marketAddress
  };
}

async function rpcBatch(rpcUrl: string, requests: Array<{ method: string; params: unknown[] }>): Promise<any[]> {
  if (!requests.length) return [];
  const payload = requests.map((request, index) => ({
    jsonrpc: "2.0", id: index + 1, method: request.method, params: request.params
  }));
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error("RPC batch HTTP " + response.status);
  if (!Array.isArray(body)) throw new Error("RPC batch returned a non-array response");
  return body;
}

async function estimateGasBatch(
  rpcUrl: string,
  transactions: any[]
): Promise<Array<{ gas: bigint | null; error?: string }>> {
  if (!transactions.length) return [];
  try {
    const responses = await rpcBatch(rpcUrl, transactions.map(tx => ({
      method: "eth_estimateGas",
      params: [{
        from: tx.from, to: tx.to, value: tx.value, data: tx.input
      }, "latest"]
    })));
    return transactions.map((_, index) => {
      const response = responses.find(item => Number(item?.id) === index + 1);
      if (response?.result) {
        try { return { gas: BigInt(String(response.result)) }; } catch {}
      }
      return { gas: null, error: String(response?.error?.message ?? "eth_estimateGas unavailable") };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return transactions.map(() => ({ gas: null, error: message }));
  }
}

export async function preflightAllLSTArbitrage(
  rpcUrl: string,
  cache: LSTArbitrageCache | undefined,
  apiKey: string | undefined,
  sender: string,
  sizeMon = 1,
  routeLimit = 2
) {
  const safeRouteLimit = Math.max(1, Math.min(MAX_EXACT_ROUTES, Math.floor(routeLimit)));
  const scan = await scanLSTArbitrage(rpcUrl, cache, apiKey, {
    probeLimit: safeRouteLimit,
    includeKyberScout: false,
    exactOnly: true
  });

  const results: any[] = [];
  const prepared: Array<{ route: any; quote: any; transactions: any[]; legResults: any[] }> = [];
  for (const route of scan.routes as any[]) {
    const quote = (route.exactQuotes ?? []).find((q: any) => q.ok === true && Number(q.sizeMon) === sizeMon)
      ?? (route.exactQuotes ?? []).find((q: any) => q.ok === true);
    if (!quote?.exactLegs?.length) {
      results.push({ route: route.path, ok: false, reason: "No exact quote legs available" });
      continue;
    }

    let amount = parseUnits(String(sizeMon), 18);
    let nativeHeld = false;
    let routeBuildable = true;
    const transactions: any[] = [];
    const legResults: any[] = [];
    const deadline = Math.floor(Date.now() / 1000) + 120;

    try {
      for (const leg of quote.exactLegs) {
        const fromIsWmon = String(leg.tokenIn).toLowerCase() === WMON_ADDRESS.toLowerCase();
        const minOut = minOutWithBuffer(String(leg.quoteAmountOutRaw));
        const kind = leg.quoteKind as QuoteKind;

        if (kind === "uniswap-v3" || kind === "uniswap-v2" || kind === "pancake-v3" || kind === "pancake-v2") {
          const router = universalRouterForQuoteKind(kind);
          if (!router) throw new Error("No Universal Router for " + kind);

          if (fromIsWmon) {
            transactions.push(
              txFrom(
                router,
                buildUniversalRouterExecute(router, leg, amount, minOut, sender, deadline, true),
                amount,
                sender
              )
            );
          } else {
            transactions.push(
              txFrom(
                leg.tokenIn,
                encodeFunctionData({
                  abi: ERC20_TX_ABI,
                  functionName: "transfer",
                  args: [router, amount]
                }),
                0n,
                sender
              )
            );
            transactions.push(
              txFrom(
                router,
                buildUniversalRouterExecute(router, leg, amount, minOut, sender, deadline, false),
                0n,
                sender
              )
            );
          }
          nativeHeld = false;
        } else if (kind === "curve-lst") {
          if (fromIsWmon && nativeHeld) {
            transactions.push(
              txFrom(
                WMON_ADDRESS,
                encodeFunctionData({ abi: WMON_WRAP_ABI, functionName: "deposit", args: [] }),
                amount,
                sender
              )
            );
            nativeHeld = false;
          }
          if (fromIsWmon && transactions.length === 0) {
            transactions.push(
              txFrom(
                WMON_ADDRESS,
                encodeFunctionData({ abi: WMON_WRAP_ABI, functionName: "deposit", args: [] }),
                amount,
                sender
              )
            );
          }
          transactions.push(
            txFrom(
              leg.tokenIn,
              encodeFunctionData({
                abi: ERC20_TX_ABI,
                functionName: "approve",
                args: [leg.pool as Address, amount]
              }),
              0n,
              sender
            )
          );
          transactions.push(
            txFrom(
              leg.pool,
              buildCurveExchange(leg, amount, minOut, sender),
              0n,
              sender
            )
          );
          nativeHeld = false;
        } else if (kind === "kuru") {
          const built = buildKuruCall(leg, amount, minOut);

          if (!built.nativeInput) {
            transactions.push(
              txFrom(
                leg.tokenIn,
                encodeFunctionData({
                  abi: ERC20_TX_ABI,
                  functionName: "approve",
                  args: [built.marketAddress as Address, amount]
                }),
                0n,
                sender
              )
            );
          } else if (fromIsWmon && !nativeHeld && transactions.length > 0) {
            transactions.push(
              txFrom(
                WMON_ADDRESS,
                encodeFunctionData({ abi: WMON_WRAP_ABI, functionName: "withdraw", args: [amount] }),
                0n,
                sender
              )
            );
          }

          transactions.push(txFrom(built.marketAddress, built.input, built.value, sender));
          nativeHeld = built.nativeInput && String(leg.tokenOut).toLowerCase() === WMON_ADDRESS.toLowerCase();
        } else if (kind === "uniswap-v4") {
          routeBuildable = false;
          legResults.push({ from: leg.from, to: leg.to, quoteKind: kind, status: "quote-only" });
          break;
        } else {
          throw new Error("Transaction builder unavailable for " + kind);
        }

        legResults.push({
          from: leg.from,
          to: leg.to,
          venue: leg.venue,
          dex: leg.dex,
          quoteKind: kind,
          amountInRaw: String(leg.amountInRaw),
          quotedOutRaw: String(leg.quoteAmountOutRaw),
          minOutRaw: minOut.toString()
        });
        amount = BigInt(String(leg.quoteAmountOutRaw));
      }

      if (!routeBuildable) {
        results.push({
          route: route.path,
          ok: true,
          quoteOnly: true,
          reason: "Uniswap V4 calldata builder is not yet wired; exact quote remains available.",
          quotedNetProfitMon: quote.netProfitMon,
          legResults
        });
        continue;
      }

      prepared.push({
        route,
        quote,
        transactions,
        legResults
      });

    } catch (error) {
      results.push({
        route: route.path,
        ok: false,
        quoteOnly: false,
        quotedNetProfitMon: quote.netProfitMon,
        error: error instanceof Error ? error.message : String(error),
        transactions,
        legResults
      });
    }
  }

  if (prepared.length > 0) {
    let blockNumber: string | null = null;
    let simulatedBlocks: any[] = [];
    let simulationError: string | null = null;

    try {
      blockNumber = await rpcJson(rpcUrl, "eth_blockNumber");
      const simulated = await rpcJson(rpcUrl, "eth_simulateV1", [{
        blockStateCalls: prepared.map((item) => ({
          stateOverrides: {
            [sender]: { balance: hexValue(1000n * 10n ** 18n) }
          },
          calls: item.transactions.map((tx: any) => ({
            from: tx.from,
            to: tx.to,
            value: tx.value,
            data: tx.input,
            gas: "0x4c4b40"
          }))
        })),
        traceTransfers: true,
        validation: true
      }, "latest"]);
      simulatedBlocks = Array.isArray(simulated) ? simulated : [];
    } catch (error) {
      simulationError = error instanceof Error ? error.message : String(error);
    }

    const gasPriceRaw = await rpcJson(rpcUrl, "eth_gasPrice").catch(() => "0x0");
    const gasPrice = BigInt(String(gasPriceRaw));

    // Use eth_estimateGas as an independent check. Profitability uses the
    // conservative maximum of estimateGas and simulation gasUsed so the
    // simulation gas ceiling cannot become the gas cost.
    const gasEstimatesByRoute = await Promise.all(
      prepared.map(item => estimateGasBatch(rpcUrl, item.transactions))
    );

    for (let index = 0; index < prepared.length; index++) {
      const item = prepared[index];
      const calls = Array.isArray(simulatedBlocks[index]?.calls)
        ? simulatedBlocks[index].calls
        : [];
      const simulatedResults = calls.map((call: any) => ({
        ok: String(call?.status ?? "0x0") === "0x1",
        status: String(call?.status ?? ""),
        gasUsed: call?.gasUsed ? String(call.gasUsed) : null,
        returnData: String(call?.returnData ?? ""),
        error: call?.error ?? null
      }));
      const successful =
        simulatedResults.length === item.transactions.length &&
        simulatedResults.every((entry: any) => entry.ok === true);

      const estimates = gasEstimatesByRoute[index] ?? [];
      const gasByTx = item.transactions.map((_, txIndex) => {
        const simulatedGas = simulatedResults[txIndex]?.gasUsed
          ? BigInt(simulatedResults[txIndex].gasUsed)
          : null;
        const estimatedGas = estimates[txIndex]?.gas ?? null;
        return {
          simulatedGas,
          estimatedGas,
          // NEVER use eth_simulateV1's configured per-call gas ceiling as
          // a profitability fallback. A failed estimate means gas is unknown.
          effectiveGas: estimatedGas,
          source: estimatedGas !== null ? "eth_estimateGas" : "unavailable",
          estimateError: estimates[txIndex]?.error ?? null
        };
      });

      const allGasEstimated =
        estimates.length === item.transactions.length &&
        estimates.every((entry: any) => entry?.gas !== null && entry?.gas !== undefined);
      const gasUnits = allGasEstimated
        ? gasByTx.reduce(
            (sum: bigint, entry: any) => sum + (entry.effectiveGas ?? 0n),
            0n
          )
        : null;
      const gasCostMon =
        gasUnits !== null ? Number(gasUnits * gasPrice) / 1e18 : null;
      const gasSource = allGasEstimated
        ? "eth_estimateGas"
        : "unavailable:incomplete-estimates";
      const gasEstimationErrors = gasByTx
        .filter((entry: any) => entry.estimateError)
        .map((entry: any, txIndex: number) => ({
          transactionIndex: txIndex,
          error: entry.estimateError
        }));

      results.push({
        route: item.route.path,
        ok: true,
        quoteOnly: false,
        sizeMon,
        quotedFinalMon: item.quote.finalMon,
        quotedGrossProfitMon: item.quote.grossProfitMon,
        quotedNetProfitMon: item.quote.netProfitMon,
        gasUnits: gasUnits?.toString() ?? null,
        gasPriceRaw: gasPrice.toString(),
        gasCostMon,
        gasSource,
        gasEstimationComplete: allGasEstimated,
        gasEstimationErrors,
        gasByTransaction: gasByTx.map((entry: any, txIndex: number) => ({
          transactionIndex: txIndex,
          simulatedGas: entry.simulatedGas?.toString() ?? null,
          estimatedGas: entry.estimatedGas?.toString() ?? null,
          effectiveGas: entry.effectiveGas?.toString() ?? null,
          estimateError: entry.estimateError ?? null,
          source: entry.source
        })),
        candidate:
          successful &&
          item.quote.candidate === true &&
          gasCostMon !== null &&
          allGasEstimated &&
          gasEstimationErrors.length === 0 &&
          item.quote.finalMon - sizeMon - gasCostMon - GAS_BUFFER_MON >= MIN_NET_PROFIT_MON,
        transactionCount: item.transactions.length,
        transactions: item.transactions,
        simulation: {
          method: "eth_simulateV1",
          blockNumber,
          successful,
          results: simulatedResults,
          error: simulationError
        },
        gasEstimation: {
          method: "eth_estimateGas",
          batched: true,
          authoritativeForProfitability: true,
          conservativeRule: "use eth_estimateGas only; simulation gasUsed is diagnostic and never a profitability fallback",
          requiresCompleteEstimates: true
        },
        legResults: item.legResults
      });
    }
  }

  return {
    mode: "PAPER_PREFLIGHT_ALL",
    generatedAt: new Date().toISOString(),
    sender,
    sizeMon,
    scan: {
      poolCount: scan.poolCount,
      routeCount: scan.routeCount,
      probeRouteCount: scan.probeRouteCount,
      exactSupportedDexes: scan.provider?.exactSupportedDexes ?? []
    },
    results,
    successfulCount: results.filter((x: any) => x.ok && x.simulation?.successful).length,
    candidateCount: results.filter((x: any) => x.candidate === true).length,
    safety: {
      broadcasted: false,
      liveExecutionEnabled: false,
      atomic: false,
      note: "Preflight only. No approval, transfer, swap, or arbitrage transaction is broadcast."
    }
  };
}

async function scoutKyberRoundTrips(rpcMonUsd = 0) {
  const mon = "0x3bd359c1119da7da1d913d1c4d2b7c461115433a";
  const amountIn = parseUnits(String(KYBER_PROBE_SIZE_MON), 18).toString();
  const results: any[] = [];
  const errors: string[] = [];
  let requestsThisScan = 0;

  for (const target of KYBER_SCOUT_TARGETS) {
    const forwardKey = "kyber:roundtrip:" + mon + ":" + target.address + ":forward:" + amountIn;
    const reverseKeyPrefix = "kyber:roundtrip:" + target.address + ":" + mon + ":reverse:";
    try {
      const forward = await fetchProviderJson<any>(
        forwardKey,
        KYBER_BASE_URL + "/monad/api/v1/routes?tokenIn=" + mon + "&tokenOut=" + target.address + "&amountIn=" + amountIn,
        { accept: "application/json", "user-agent": "geld-arbitrage/1.0", "x-client-id": KYBER_CLIENT_ID },
        KYBER_CACHE_TTL_MS
      );
      if (!forward.fromCache) requestsThisScan++;
      const routeSummary = forward.data?.data?.routeSummary;
      const mid = String(routeSummary?.amountOut ?? "");
      if (!/^\d+$/.test(mid) || BigInt(mid) <= 0n) {
        errors.push("Kyber no forward quote for " + target.symbol);
        continue;
      }

      const reverse = await fetchProviderJson<any>(
        reverseKeyPrefix + mid,
        KYBER_BASE_URL + "/monad/api/v1/routes?tokenIn=" + target.address + "&tokenOut=" + mon + "&amountIn=" + mid,
        { accept: "application/json", "user-agent": "geld-arbitrage/1.0", "x-client-id": KYBER_CLIENT_ID },
        KYBER_CACHE_TTL_MS
      );
      if (!reverse.fromCache) requestsThisScan++;

      const backRaw = String(reverse.data?.data?.routeSummary?.amountOut ?? "");
      if (!/^\d+$/.test(backRaw) || BigInt(backRaw) <= 0n) {
        errors.push("Kyber no reverse quote for " + target.symbol);
        continue;
      }

      const backMon = Number(backRaw) / 1e18;
      const grossProfitMon = backMon - KYBER_PROBE_SIZE_MON;
      const gasUsd = Number(routeSummary?.gasUsd ?? 0) + Number(reverse.data?.data?.routeSummary?.gasUsd ?? 0);
      const impliedMonUsd = rpcMonUsd > 0
        ? rpcMonUsd
        : target.symbol === "USDC"
          ? (Number(mid) / 1e6) / KYBER_PROBE_SIZE_MON
          : 0;
      const gasMon = impliedMonUsd > 0 ? gasUsd / impliedMonUsd : 0;
      const netProfitMon = grossProfitMon - gasMon - GAS_BUFFER_MON;

      const flatten = (summary: any) =>
        (summary?.route ?? []).flat().map((leg: any) => ({
          exchange: String(leg?.exchange ?? ""),
          poolType: String(leg?.poolType ?? ""),
          pool: String(leg?.pool ?? ""),
          tokenIn: String(leg?.tokenIn ?? ""),
          tokenOut: String(leg?.tokenOut ?? ""),
          swapAmount: String(leg?.swapAmount ?? ""),
          amountOut: String(leg?.amountOut ?? "")
        }));

      results.push({
        provider: "kyberswap",
        path: ["MON", target.symbol, "MON"],
        sizeMon: KYBER_PROBE_SIZE_MON,
        intermediateAmountRaw: mid,
        finalMon: backMon,
        grossProfitMon,
        gasUsd,
        gasMon,
        netProfitMon,
        candidate: netProfitMon >= MIN_NET_PROFIT_MON,
        routes: {
          forward: flatten(routeSummary),
          reverse: flatten(reverse.data?.data?.routeSummary)
        }
      });
    } catch (error) {
      errors.push(error instanceof Error
        ? "Kyber " + target.symbol + ": " + error.message
        : "Kyber " + target.symbol + ": " + String(error));
    }
  }

  results.sort((a, b) => b.netProfitMon - a.netProfitMon);
  return {
    enabled: true,
    probeSizeMon: KYBER_PROBE_SIZE_MON,
    requestsThisScan,
    targetCount: KYBER_SCOUT_TARGETS.length,
    results,
    topSignal: results.find(x => x.candidate === true) ?? null,
    errors: errors.length ? [...new Set(errors)] : undefined
  };
}


function findCycles(
  edges: PoolEdge[],
  startAddress: string,
  maxHops = MAX_ARBITRAGE_HOPS,
  maxResults = 5000
): any[] {
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
    if (results.length >= maxResults) return;

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
    if (results.length >= maxResults) return;

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
    const market = edge.kuruMarket;
    if (!market) return null;

    const cacheKey = market.marketAddress.toLowerCase();
    const cachedMarket = kuruParamsCache.get(cacheKey) ?? market;
    kuruParamsCache.set(cacheKey, cachedMarket);

    const fromIsBase =
      edge.from.toLowerCase() === cachedMarket.baseAssetAddress.toLowerCase();
    const fromIsQuote =
      edge.from.toLowerCase() === cachedMarket.quoteAssetAddress.toLowerCase();

    if (!fromIsBase && !fromIsQuote) return null;

    const inputDecimals = fromIsBase
      ? cachedMarket.baseAssetPrecision
      : cachedMarket.quoteAssetPrecision;

    const precision = fromIsBase
      ? BigInt(String(cachedMarket.sizePrecision))
      : BigInt(cachedMarket.pricePrecision);

    if (!(precision > 0n) || inputDecimals < 0 || inputDecimals > 36) {
      return null;
    }

    const scale = 10n ** BigInt(inputDecimals);
    const marketSize = amountIn * precision / scale;
    if (marketSize <= 0n || marketSize > ((1n << 96n) - 1n)) {
      return null;
    }

    const nativeInput =
      (fromIsBase && cachedMarket.baseAsset.toUpperCase() === "MON") ||
      (fromIsQuote && cachedMarket.quoteAsset.toUpperCase() === "MON");

    const amountOut = fromIsBase
      ? await (client as any).readContract({
          address: cachedMarket.marketAddress as Address,
          abi: KURU_MARKET_ABI,
          functionName: "placeAndExecuteMarketSell",
          args: [marketSize, 0n, false, true],
          value: nativeInput ? amountIn : 0n
        })
      : await (client as any).readContract({
          address: cachedMarket.marketAddress as Address,
          abi: KURU_MARKET_ABI,
          functionName: "placeAndExecuteMarketBuy",
          args: [marketSize, 0n, false, true],
          value: nativeInput ? amountIn : 0n
        });

    return {
      amountOut: BigInt(amountOut as bigint),
      feeBps: cachedMarket.takerFeeBps,
      feePct: cachedMarket.takerFeeBps / 100,
      feeSource: "kuru_market_exact_simulation"
    };
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
        gasEstimate: quote.gasEstimate?.toString() ?? null,
        kuruMarket: leg.kuruMarket ?? null
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

export type LSTArbitrageScanOptions = {
  probeLimit?: number;
  includeKyberScout?: boolean;
  discoveryOnly?: boolean;
  exactOnly?: boolean;
};

export async function scanLSTArbitrage(
  rpcUrl: string,
  cache?: LSTArbitrageCache,
  apiKey?: string,
  options: LSTArbitrageScanOptions = {}
) {
  const probeLimit = Math.max(1, Math.min(6, Math.floor(options.probeLimit ?? MAX_EXACT_ROUTES)));
  const includeKyberScout = options.includeKyberScout !== false;
  const discovery = await discoverDexPaprikaMonadPools(cache, apiKey);
  const assets = new Map<string, ArbitrageAsset>(assetMap());
  for (const asset of discovery.assets ?? []) {
    assets.set(asset.address.toLowerCase(), asset);
  }
  const kuruDiscovery = await discoverKuruMarkets(cache, assets);
  for (const asset of kuruDiscovery.assets ?? []) {
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
  const kuruParsedPools = kuruDiscovery.pools
    .map((record: any) => parseDiscoveredPool(record, assets))
    .filter(
      (pool: PoolRecord | null): pool is PoolRecord =>
        pool !== null
    );
  for (const pool of kuruParsedPools) {
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

  const discoveryCycles = findCycles(
    edges,
    wmon.address.toLowerCase(),
    MAX_ARBITRAGE_HOPS,
    5000
  );

  const allRoutes = discoveryCycles
    .filter((route) =>
      route.legs.every((leg: PoolEdge) => isExactQuoteSupported(leg.quoteKind))
    )
    .filter(
      route =>
        new Set(
          route.legs.map((leg: PoolEdge) => leg.pool.toLowerCase())
        ).size >= 2
    )
    .filter(
      route =>
        route.legs.every(
          (leg: PoolEdge) => leg.liquidityUsd >= MIN_LIQUIDITY_USD
        )
    )
    .map(route => ({
      ...route,
      distinctDexes: new Set(
        route.legs.map((leg: PoolEdge) => leg.dex.toLowerCase())
      ).size,
      distinctPools: new Set(
        route.legs.map((leg: PoolEdge) => leg.pool.toLowerCase())
      ).size,
      liquidityScore: Math.min(
        ...route.legs.map((leg: PoolEdge) => leg.liquidityUsd)
      ),
      volumeScore: route.legs.reduce(
        (sum: number, leg: PoolEdge) => sum + leg.volume24hUsd,
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

  const discoveryRoutes = discoveryCycles
    .map(route => ({
      ...route,
      distinctDexes: new Set(
        route.legs.map((leg: PoolEdge) => leg.dex.toLowerCase())
      ).size,
      distinctPools: new Set(
        route.legs.map((leg: PoolEdge) => leg.pool.toLowerCase())
      ).size,
      exactQuoteSupported: route.legs.every(
        (leg: PoolEdge) => isExactQuoteSupported(leg.quoteKind)
      ),
      discoveryOnly: !route.legs.every(
        (leg: PoolEdge) => isExactQuoteSupported(leg.quoteKind)
      ),
      liquidityScore: Math.min(
        ...route.legs.map((leg: PoolEdge) => leg.liquidityUsd)
      ),
      volumeScore: route.legs.reduce(
        (sum: number, leg: PoolEdge) => sum + leg.volume24hUsd,
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
    )
    .slice(0, 200);

  const seenRouteKeys = new Set<string>();
  const remainingRoutes = allRoutes.filter(route => {
    if (options.exactOnly && !route.exactQuoteSupported) return false;

    const key = route.legs
      .map((leg: PoolEdge) => leg.pool.toLowerCase())
      .join("|");

    if (seenRouteKeys.has(key)) return false;
    seenRouteKeys.add(key);
    return true;
  });

  const probeRoutes: any[] = [];
  const coveredProbeDexes = new Set<string>();

  // Always spend one exact probe on Kuru when a complete Kuru cycle exists.
  // This prevents a neutral discovery rate from starving Kuru routes from
  // exact validation.
  const isCrossVenueKuru = (route: any) => {
    const dexes = new Set(
      route.legs.map((leg: PoolEdge) => String(leg.dex).toLowerCase())
    );
    return (
      route.legs.some((leg: PoolEdge) => leg.quoteKind === "kuru") &&
      dexes.size >= 2
    );
  };
  const isKuruMonUsdc = (route: any) =>
    isCrossVenueKuru(route) &&
    route.legs.some(
      (leg: PoolEdge) =>
        leg.quoteKind === "kuru" &&
        String(leg.kuruMarket?.symbol ?? "").toUpperCase() === "MON_USDC"
    );

  let kuruIndex = remainingRoutes.findIndex(isKuruMonUsdc);
  if (kuruIndex < 0) {
    kuruIndex = remainingRoutes.findIndex(isCrossVenueKuru);
  }
  if (kuruIndex >= 0 && probeRoutes.length < probeLimit) {
    const [kuruRoute] = remainingRoutes.splice(kuruIndex, 1);
    probeRoutes.push(kuruRoute);
    for (const leg of kuruRoute.legs) {
      coveredProbeDexes.add(leg.dex.toLowerCase());
    }
  }

  while (
    probeRoutes.length < probeLimit &&
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

      // Probe the routes that look most profitable first. Discovery prices are
      // only a ranking hint; exact on-chain quotes remain the final gate.
      // DEX diversity is still a secondary tie-breaker so one venue cannot
      // monopolize every probe slot.
      const theoreticalEdgeScore =
        Math.max(-100, Number(route.grossEdgePct ?? -100)) * 1_000_000;
      const dexDiversityWeight = options.exactOnly
        ? 10_000_000
        : 100_000;
      const score =
        theoreticalEdgeScore +
        newDexCount * dexDiversityWeight +
        route.distinctDexes * 10_000 +
        route.distinctPools * 1_000 +
        Math.min(route.liquidityScore, 1_000_000);

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

  const cycleTokenAddresses = new Set<string>();
  for (const route of discoveryCycles) {
    for (const leg of route.legs as PoolEdge[]) {
      cycleTokenAddresses.add(leg.from.toLowerCase());
      cycleTokenAddresses.add(leg.to.toLowerCase());
    }
  }

  const arbitragePotentialTokens = buildArbitragePotentialTokens(
    pools,
    assets,
    cycleTokenAddresses
  );

  if (options.discoveryOnly) {
    return {
      mode: "PAPER_DISCOVERY_ONLY" as const,
      generatedAt: new Date().toISOString(),
      rpcUrl,
      buildRevision: LST_ARBITRAGE_BUILD_REVISION,
      assets: [...assets.values()],
      poolCount: pools.length,
      edgeCount: edges.length,
      triangleCount: allRoutes.length,
      cycleCount: allRoutes.length,
      routeCount: allRoutes.length,
      discoveryRouteCount: discoveryRoutes.length,
      probeRouteCount: 0,
      arbitragePotentialTokenCount: arbitragePotentialTokens.length,
      arbitragePotentialTokens,
      discoveredTokenCount: assets.size,
      discoveredTokens: [...assets.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
      availableDexCount:
        new Set([
          ...(discovery.provider.availableDexes ?? []),
          ...(kuruDiscovery.provider.availableDexes ?? [])
        ]).size,
      exactSupportedDexCount: [
        ...new Set(
          pools
            .filter(pool => isExactQuoteSupported(pool.quoteKind))
            .map(pool => pool.dex)
        )
      ].length,
      routes: [],
      discoveryRoutes,
      signals: [],
      topSignal: null,
      kyberScout: {
        enabled: false,
        requestsThisScan: 0,
        targetCount: 0,
        results: [],
        topSignal: null
      },
      aggregatorSignals: [],
      topAggregatorSignal: null,
      provider: {
        ...discovery.provider,
        requestsThisScan:
          Number(discovery.provider.requestsThisScan ?? 0) +
          Number(kuruDiscovery.provider.requestsThisScan ?? 0),
        kuruRequestsThisScan: kuruDiscovery.provider.requestsThisScan,
        kuruMarketCount: kuruDiscovery.provider.marketCount,
        kuruAvailable: kuruDiscovery.provider.marketCount > 0,
        kuruErrors: kuruDiscovery.provider.errors,
        parsedPoolCount: parsedPools.length + kuruParsedPools.length,
        discoveredDexes: [...new Set(pools.map(pool => pool.dex))].sort(),
        exactSupportedDexes: [
          ...new Set(
            pools
              .filter(pool => isExactQuoteSupported(pool.quoteKind))
              .map(pool => pool.dex)
          )
        ].sort(),
        exactUnsupportedDexes: [
          ...new Set(
            pools
              .filter(pool => !isExactQuoteSupported(pool.quoteKind))
              .map(pool => pool.dex)
          )
        ].sort(),
        note:
          "Discovery mode scans the dynamic Monad token/DEX universe without performing exact " +
          "quote probes. Potential rows are not execution or profitability confirmations."
      },
      execution: {
        live: false,
        attempted: false,
        submitted: false,
        transactionsSubmitted: 0,
        reason: "Discovery-only scanner. No transaction submission is performed."
      }
    };
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

  const kyberScout = includeKyberScout
    ? await scoutKyberRoundTrips(
        (() => {
          const usdcQuote = exactResults
            .flatMap((route: any) => route.exactQuotes ?? [])
            .find((q: any) => q.ok === true && q.finalQuoteRaw && q.sizeMon > 0);
          return usdcQuote && usdcQuote.finalQuoteRaw
            ? Number(usdcQuote.finalQuoteRaw) / 1e6 / Number(usdcQuote.sizeMon)
            : 0;
        })()
      )
    : {
    enabled: false,
    probeSizeMon: KYBER_PROBE_SIZE_MON,
    requestsThisScan: 0,
    targetCount: 0,
    results: [],
    topSignal: null
  };

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
    discoveryRouteCount: discoveryRoutes.length,
    probeRouteCount: probeRoutes.length,
    arbitragePotentialTokenCount: arbitragePotentialTokens.length,
    arbitragePotentialTokens,
    discoveredTokenCount: assets.size,
    discoveredTokens: [...assets.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    availableDexCount:
      new Set([
        ...(discovery.provider.availableDexes ?? []),
        ...(kuruDiscovery.provider.availableDexes ?? [])
      ]).size,
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
    discoveryRoutes,
    signals,
    topSignal: signals[0] ?? null,
    kyberScout,
    aggregatorSignals: kyberScout.results,
    topAggregatorSignal: kyberScout.topSignal,
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
      requestsThisScan:
        Number(discovery.provider.requestsThisScan ?? 0) +
        Number(kuruDiscovery.provider.requestsThisScan ?? 0),
      kuruRequestsThisScan: kuruDiscovery.provider.requestsThisScan,
      kuruMarketCount: kuruDiscovery.provider.marketCount,
      kuruAvailable: kuruDiscovery.provider.marketCount > 0,
      kuruErrors: kuruDiscovery.provider.errors,
      parsedPoolCount: parsedPools.length + kuruParsedPools.length,
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
      plannedKuruRequests: PLANNED_KURU_REQUESTS,\n      plannedExactAndRefinementRequests: PLANNED_EXACT_REQUESTS,
      plannedWorstCaseExternalRequests:
        PLANNED_WORST_CASE_EXTERNAL_REQUESTS,
      safetyMarginRequests: FREE_EXTERNAL_SUBREQUEST_LIMIT - PLANNED_WORST_CASE_EXTERNAL_REQUESTS,
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