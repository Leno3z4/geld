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
// LST arbitrage scanner: DexPaprika DEX-catalog discovery with exact on-chain quotes.
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
export const MAX_EXACT_ROUTES = 8;
export const MAX_REFINED_ROUTES = 1;
export const PROBE_SIZE_MON = 1;
const EXECUTION_BUFFER_BPS = Math.round(EXECUTION_BUFFER_PCT * 100);
const DEXPAPRIKA_POOLS_URL = "https://api.dexpaprika.com/networks/monad/pools/search";
const PANCAKE_V3_QUOTER_V2 = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as Address;
const UNISWAP_V4_POOL_MANAGER =
  "0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e" as Address;
const UNISWAP_V4_QUOTER =
  "0xa222Dd357A9076d1091Ed6Aa2e16C9742dD26891" as Address;
const DEXSCREENER_TOKEN_URL = "https://api.dexscreener.com/tokens/v1/monad";
const DEXSCREENER_CACHE_TTL_MS = 60_000;
const DEXPAPRIKA_CACHE_TTL_MS = 5 * 60_000;
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

type QuoteKind = "uniswap-v4" | "uniswap-v3" | "uniswap-v2" | "pancake-v3" | "pancake-v2" | "curve-lst" | "kuru" | "unsupported";

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
  const symbol = String((value as Record<string, unknown>).symbol ?? "").trim();
  return symbol || fallback;
}

function tokenDecimals(value: unknown, fallback = 18) {
  if (!value || typeof value !== "object") return fallback;
  const decimals = Number((value as Record<string, unknown>).decimals);
  return Number.isFinite(decimals) && decimals >= 0 && decimals <= 36 ? decimals : fallback;
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


async function discoverDexPaprikaPools(cache?: LSTArbitrageCache) {
  // Enumerate the DEX catalog first. The network-wide pool endpoint can
  // return an incomplete slice behind some edge/CDN paths, while the DEX
  // catalog exposes the indexed Monad venues deterministically.
  const key = "lst-arb:dexpaprika:pools:v5";
  const now = Date.now();
  const cached = await readCache<any[]>(cache, key);

  if (cached && now - cached.fetchedAt < DEXPAPRIKA_CACHE_TTL_MS) {
    return {
      pools: cached.data,
      provider: {
        name: "DexPaprika DEX-catalog discovery",
        requestsThisScan: 0,
        cached: true,
        fetchedAt: cached.fetchedAt,
        queryMode: "per_dex_catalog",
        poolCount: cached.data.length
      }
    };
  }

  const deduped = new Map<string, any>();
  const errors: string[] = [];
  let requestsThisScan = 0;
  let truncated = false;

  async function fetchJsonUrl(url: URL) {
    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "geld-lst-arbitrage/1.0"
      }
    });
    requestsThisScan++;

    if (!response.ok) {
      throw new Error("DexPaprika HTTP " + response.status);
    }

    return response.json() as Promise<any>;
  }

  try {
    const dexUrl = new URL("https://api.dexpaprika.com/networks/monad/dexes");
    const dexJson = await fetchJsonUrl(dexUrl);
    const dexes = Array.isArray(dexJson?.dexes)
      ? dexJson.dexes
      : Array.isArray(dexJson?.results)
        ? dexJson.results
        : [];

    if (dexes.length === 0) {
      throw new Error("DexPaprika returned no Monad DEX entries");
    }

    // Current Monad coverage fits one 100-row page per DEX. If a venue
    // grows beyond 100 pools, fetch one additional cursor page and mark
    // the scan truncated rather than using unbounded Worker subrequests.
    for (const dex of dexes) {
      const dexId = String(dex?.dex_id ?? dex?.id ?? "").trim();
      if (!dexId) continue;

      try {
        let cursor = "";
        for (let page = 1; page <= 2; page++) {
          const url = new URL(DEXPAPRIKA_POOLS_URL);
          url.searchParams.set("dex_name", dexId);
          url.searchParams.set("order_by", "volume_usd_24h");
          url.searchParams.set("sort", "desc");
          url.searchParams.set("limit", "100");
          if (cursor) url.searchParams.set("cursor", cursor);

          const json = await fetchJsonUrl(url);
          const rows = Array.isArray(json?.results) ? json.results : [];

          for (const pool of rows) {
            const id = String(pool?.id ?? "");
            if (id) deduped.set(id.toLowerCase(), pool);
          }

          if (!json?.has_next_page) break;

          const nextCursor = String(json?.next_cursor ?? "");
          if (!nextCursor || nextCursor === cursor) {
            truncated = true;
            break;
          }

          cursor = nextCursor;
          if (page === 2) truncated = true;
        }
      } catch (error) {
        errors.push(
          dexId + ": " + (error instanceof Error ? error.message : String(error))
        );
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const pools = [...deduped.values()];
  if (pools.length > 0) {
    await writeCache(cache, key, pools, now);
  }

  const provider: Record<string, unknown> = {
    name: "DexPaprika DEX-catalog discovery",
    requestsThisScan,
    cached: false,
    fetchedAt: now,
    queryMode: "per_dex_catalog",
    poolCount: pools.length,
    dexCount: new Set(
      pools.map(pool => String(pool?.dex_id ?? "").toLowerCase()).filter(Boolean)
    ).size,
    truncated,
    pageSize: 100,
    externalMarketDataRequired: false
  };

  if (errors.length > 0) {
    provider.errors = errors;
  }

  return { pools, provider };
}
function parseDexPaprikaPool(record: any, assets: Map<string, ArbitrageAsset>): PoolRecord | null {
  const tokens = Array.isArray(record?.tokens) ? record.tokens : [];
  const firstRaw = tokens[0];
  const secondRaw = tokens[1];

  const base =
    normalizeAssetAddress(tokenIdentifier(firstRaw)) ||
    normalizeAssetAddress(record?.base_token_id);
  const quote =
    normalizeAssetAddress(tokenIdentifier(secondRaw)) ||
    normalizeAssetAddress(record?.quote_token_id);

  if (!base || !quote || base === quote) return null;

  const existingBase = assets.get(base);
  const existingQuote = assets.get(quote);

  const baseAsset = existingBase ?? {
    symbol: tokenSymbol(firstRaw, shortAddress(base)),
    address: base,
    decimals: tokenDecimals(firstRaw)
  };
  const quoteAsset = existingQuote ?? {
    symbol: tokenSymbol(secondRaw, shortAddress(quote)),
    address: quote,
    decimals: tokenDecimals(secondRaw)
  };

  if (!existingBase) assets.set(base, baseAsset);
  if (!existingQuote) assets.set(quote, quoteAsset);

  const dexId = String(record?.dex_id ?? "").toLowerCase();
  const dexName = String(record?.dex_name ?? record?.dex_id ?? "unknown");
  const protocol = String(record?.protocol ?? "").toLowerCase();
  const isV4 =
    dexId === "uniswap_v4" ||
    protocol.includes("uniswapv4") ||
    dexName.toLowerCase().includes("uniswap v4");

  const poolAddress = isV4 ? bytes32(record?.id) : addr(record?.id);
  if (!poolAddress) return null;

  let quoteKind: QuoteKind = "unsupported";
  if (poolAddress.toLowerCase() === CURVE_LST_POOL.toLowerCase()) {
    quoteKind = "curve-lst";
  } else if (isV4) {
    quoteKind = "uniswap-v4";
  } else if (
    dexId === "uniswap_v3" ||
    protocol.includes("uniswapv3") ||
    dexId === "dyorswap"
  ) {
    quoteKind = "uniswap-v3";
  } else if (
    dexId === "uniswap_v2" ||
    protocol.includes("uniswapv2")
  ) {
    quoteKind = "uniswap-v2";
  } else if (
    dexId === "pancakeswap_v3" ||
    dexId === "pancake_v3" ||
    protocol.includes("pancakeswapv3")
  ) {
    quoteKind = "pancake-v3";
  } else if (
    dexId === "pancakeswap_v2" ||
    dexId === "pancake_v2"
  ) {
    quoteKind = "pancake-v2";
  } else if (
    dexId === "kuru" ||
    dexName.toLowerCase().includes("kuru")
  ) {
    quoteKind = "kuru";
  }

  return {
    id: poolAddress,
    name: `${baseAsset.symbol}/${quoteAsset.symbol} ${dexName}`,
    address: poolAddress,
    base,
    quote,
    baseSymbol: baseAsset.symbol,
    quoteSymbol: quoteAsset.symbol,
    baseToQuote: 1,
    feePct: num(record?.fee),
    liquidityUsd: num(record?.liquidity_usd),
    volume24hUsd: num(record?.volume_usd_24h),
    dex: dexId || dexName,
    quoteKind,
    createdAtBlock:
      record?.created_at_block_number !== undefined
        ? String(record.created_at_block_number)
        : undefined
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
  if (d.includes("uniswap") && d.includes("v4")) return "uniswap-v4" as const;
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
function findCycles(edges: PoolEdge[], startAddress: string, maxHops = 3): any[] {
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
        leg => leg.quoteKind !== "unsupported"
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
      gasEstimate: values[1]
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
    // Kuru is discovered as a venue, but exact market-buy/sell estimation
    // requires its orderbook state (CostEstimator / L2 book). Do not turn a
    // guessed mid-price into an arbitrage signal.
    let params = kuruParamsCache.get(edge.pool.toLowerCase());
    if (!params) {
      params = await client.readContract({
        address: edge.pool as Address,
        abi: KURU_MARKET_ABI,
        functionName: "getMarketParams"
      });
      kuruParamsCache.set(edge.pool.toLowerCase(), params);
    }
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
  cache?: LSTArbitrageCache
) {
  const assets = assetMap();
  const discovery = await discoverDexPaprikaPools(cache);

  const parsedPools = discovery.pools
    .map((record: any) => parseDexPaprikaPool(record, assets))
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
    3
  )
    .filter(route => route.exactQuoteSupported)
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
  const probeRoutes = allRoutes
    .filter(route => {
      const key = route.legs
        .map((leg: PoolEdge) =>
          leg.pool.toLowerCase()
        )
        .join("|");

      if (seenRouteKeys.has(key)) return false;
      seenRouteKeys.add(key);
      return true;
    })
    .slice(0, MAX_EXACT_ROUTES);

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

  const exactResults = await Promise.all(
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

      return {
        ...route,
        exactQuotes,
        refined: true
      };
    })
  );

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
    assets: [...assets.values()],
    poolCount: pools.length,
    edgeCount: edges.length,
    triangleCount: allRoutes.length,
    cycleCount: allRoutes.length,
    routeCount: allRoutes.length,
    probeRouteCount: probeRoutes.length,
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
      name:
        "DexPaprika DEX-catalog discovery",
      requestsThisScan:
        discovery.provider.requestsThisScan,
      cached: discovery.provider.cached ?? false,
      stale: discovery.provider.stale ?? false,
      poolCount:
        discovery.provider.poolCount ??
        discovery.pools.length,
      parsedPoolCount: parsedPools.length,
      truncated:
        discovery.provider.truncated ?? false,
      queryMode:
        discovery.provider.queryMode ??
        "per_dex_catalog",
      externalMarketDataRequired: false,
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
      unsupportedDexes: [
        ...new Set(
          pools
            .filter(
              pool => pool.quoteKind === "unsupported"
            )
            .map(pool => pool.dex)
        )
      ].sort(),
      note:
        "Routes are built from the network-wide indexed pool graph. " +
        "Profitability is accepted only after exact sequential on-chain " +
        "quotes, with each leg consuming the actual output of the prior leg."
    },
    execution: {
      live: false,
      transactionsSubmitted: 0,
      reason:
        "Paper-only scanner. No transaction submission is performed."
    }
  };
}
