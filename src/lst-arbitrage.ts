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
// LST arbitrage scanner: DexPaprika network-wide discovery with exact on-chain quotes.
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
export const PROBE_SIZE_MON = 1;
const EXECUTION_BUFFER_BPS = Math.round(EXECUTION_BUFFER_PCT * 100);
const GECKO_NETWORK = "monad";
const GECKO_DEXES_URL =
  "https://api.geckoterminal.com/api/v2/networks/monad/dexes";
const GECKO_DEX_CACHE_TTL_MS = 15 * 60_000;
const GECKO_DEX_POOL_CACHE_TTL_MS = 5 * 60_000;
const GECKO_DEXES_PER_SCAN = 1;
const GECKO_POOL_PAGES_PER_DEX_REFRESH = 1;
const KURU_EXCHANGE_INFO_URL = "https://exchange.kuru.io/api/v3/exchangeInfo";
const KURU_DEPTH_URL = "https://exchange.kuru.io/api/v3/depth";
const FREE_EXTERNAL_SUBREQUEST_LIMIT = 50;
const PLANNED_DISCOVERY_REQUESTS =
  1 + GECKO_DEXES_PER_SCAN * GECKO_POOL_PAGES_PER_DEX_REFRESH;
const PLANNED_EXACT_REQUESTS =
  MAX_EXACT_ROUTES * 3 * 2 + TRADE_SIZES_MON.length;
const PLANNED_WORST_CASE_EXTERNAL_REQUESTS =
  PLANNED_DISCOVERY_REQUESTS + PLANNED_EXACT_REQUESTS;
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


async function discoverGeckoMonadDexPools(
  cache?: LSTArbitrageCache
) {
  const inventoryKey = "lst-arb:gecko:dexes:v2";
  const lastGoodInventoryKey = "lst-arb:gecko:dexes:last-good:v2";
  const now = Date.now();

  const [cachedInventory, lastGoodInventory] =
    await Promise.all([
      readCache<any[]>(cache, inventoryKey),
      readCache<any[]>(cache, lastGoodInventoryKey)
    ]);

  let inventory: any[] = [];
  let inventoryCached = false;
  let inventoryStale = false;
  let inventoryStaleFrom: number | null = null;
  let inventoryRequestsThisScan = 0;
  const errors: string[] = [];

  if (
    cachedInventory &&
    now - cachedInventory.fetchedAt < GECKO_DEX_CACHE_TTL_MS
  ) {
    inventory = cachedInventory.data;
    inventoryCached = true;
  } else {
    try {
      const response = await fetch(
        `${GECKO_DEXES_URL}?page=1`,
        {
          headers: {
            accept: "application/json;version=20230203",
            "user-agent": "geld-lst-arbitrage/1.0"
          }
        }
      );
      inventoryRequestsThisScan++;

      if (!response.ok) {
        const retry = retryAfterMs(
          response.headers.get("retry-after")
        );
        throw new GeckoHttpError(
          response.status,
          retry,
          "GeckoTerminal DEX inventory HTTP " +
            response.status
        );
      }

      const json = await response.json() as any;
      inventory = Array.isArray(json?.data)
        ? json.data
        : [];

      if (inventory.length === 0) {
        throw new Error(
          "GeckoTerminal returned an empty Monad DEX inventory"
        );
      }

      await writeCache(
        cache,
        inventoryKey,
        inventory,
        now
      );
      await writeCache(
        cache,
        lastGoodInventoryKey,
        inventory,
        now
      );
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : String(error)
      );

      const fallback =
        lastGoodInventory?.data?.length
          ? lastGoodInventory
          : cachedInventory;

      if (fallback?.data?.length) {
        inventory = fallback.data;
        inventoryStale = true;
        inventoryStaleFrom = fallback.fetchedAt;
      }
    }
  }

  const normalizedInventory = inventory
    .map(item => ({
      dexId: String(
        item?.id ??
          item?.attributes?.id ??
          ""
      ).toLowerCase(),
      dexName: String(
        item?.attributes?.name ??
          item?.name ??
          item?.id ??
          "unknown"
      ),
      protocol: String(
        item?.attributes?.protocol ??
          item?.protocol ??
          ""
      )
    }))
    .filter((dex: any) => Boolean(dex.dexId));

  const refreshedDexes: string[] = [];
  const freshDexes: string[] = [];
  const staleDexes: string[] = [];
  const missingDexSnapshots: string[] = [];
  const allPoolRecords: any[] = [];
  let poolRequestsThisScan = 0;

  const rotationBase =
    Math.floor(now / 60_000) *
    GECKO_DEXES_PER_SCAN;

  const selectedDexes: any[] = [];
  if (normalizedInventory.length > 0) {
    const count = Math.min(
      GECKO_DEXES_PER_SCAN,
      normalizedInventory.length
    );
    const start =
      rotationBase % normalizedInventory.length;

    for (let offset = 0; offset < count; offset++) {
      selectedDexes.push(
        normalizedInventory[
          (start + offset) % normalizedInventory.length
        ]
      );
    }
  }

  for (const dex of selectedDexes) {
    const safeDexId = encodeURIComponent(dex.dexId);
    const cacheKey =
      `lst-arb:gecko:dex:${dex.dexId}:pools:v2`;
    const lastGoodKey =
      `lst-arb:gecko:dex:${dex.dexId}:last-good:v2`;
    const [cachedPools, lastGoodPools] =
      await Promise.all([
        readCache<any[]>(cache, cacheKey),
        readCache<any[]>(cache, lastGoodKey)
      ]);

    let snapshot = cachedPools;
    const isFresh =
      Boolean(
        cachedPools &&
        now - cachedPools.fetchedAt <
          GECKO_DEX_POOL_CACHE_TTL_MS
      );

    if (!isFresh) {
      // No per-DEX attempt lock: six DEXes are deliberately refreshed
      // every invocation. This guarantees the five-minute warm-up completes
      // and keeps the worst-case external request budget at 46/50.
      try {
          const url =
            `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/dexes/${safeDexId}/pools?page=1&include=base_token,quote_token,dex`;

          const response = await fetch(url, {
            headers: {
              accept:
                "application/json;version=20230203",
              "user-agent":
                "geld-lst-arbitrage/1.0"
            }
          });
          poolRequestsThisScan++;

          if (!response.ok) {
            const retry = retryAfterMs(
              response.headers.get("retry-after")
            );
            throw new GeckoHttpError(
              response.status,
              retry,
              `GeckoTerminal ${dex.dexId} pool HTTP ${response.status}`
            );
          }

          const json = await response.json() as any;
          const rows = Array.isArray(json?.data)
            ? json.data
            : [];

          if (rows.length === 0) {
            throw new Error(
              `GeckoTerminal returned no pools for ${dex.dexId}`
            );
          }

          const includedById = new Map<string, any>(
            (Array.isArray(json?.included)
              ? json.included
              : []
            ).map((item: any) => [
              String(item?.id ?? ""),
              item
            ])
          );

          const enriched = rows.map((record: any) => {
            const baseId = String(
              record?.relationships?.base_token?.data?.id ??
                ""
            );
            const quoteId = String(
              record?.relationships?.quote_token?.data?.id ??
                ""
            );
            const dexId =
              String(
                record?.relationships?.dex?.data?.id ??
                  dex.dexId
              );

            return {
              ...record,
              __baseTokenMeta:
                includedById.get(baseId),
              __quoteTokenMeta:
                includedById.get(quoteId),
              __dexMeta:
                includedById.get(dexId)
            };
          });

          snapshot = {
            fetchedAt: now,
            data: enriched
          };

          await writeCache(
            cache,
            cacheKey,
            enriched,
            now
          );
          await writeCache(
            cache,
            lastGoodKey,
            enriched,
            now
          );

          refreshedDexes.push(dex.dexId);
      } catch (error) {
        errors.push(
          error instanceof Error
            ? error.message
            : String(error)
        );

        if (lastGoodPools?.data?.length) {
          snapshot = lastGoodPools;
        }
      }
    }

    if (snapshot?.data?.length) {
      allPoolRecords.push(...snapshot.data);

      if (
        now - snapshot.fetchedAt <
        GECKO_DEX_POOL_CACHE_TTL_MS
      ) {
        freshDexes.push(dex.dexId);
      } else {
        staleDexes.push(dex.dexId);
      }
    } else {
      missingDexSnapshots.push(dex.dexId);
    }
  }

  // Use every cached DEX snapshot, not only the six refreshed this minute.
  // After five rotation minutes, all inventory DEXes have had a refresh slot.
  for (const dex of normalizedInventory) {
    if (
      selectedDexes.some(
        selected => selected.dexId === dex.dexId
      )
    ) {
      continue;
    }

    const snapshot = await readCache<any[]>(
      cache,
      `lst-arb:gecko:dex:${dex.dexId}:pools:v2`
    );

    if (snapshot?.data?.length) {
      allPoolRecords.push(...snapshot.data);

      if (
        now - snapshot.fetchedAt <
        GECKO_DEX_POOL_CACHE_TTL_MS
      ) {
        freshDexes.push(dex.dexId);
      } else {
        staleDexes.push(dex.dexId);
      }
    } else {
      missingDexSnapshots.push(dex.dexId);
    }
  }

  const dedupedPools = new Map<string, any>();
  for (const record of allPoolRecords) {
    const poolAddress = poolIdentifier(
      record?.attributes?.address ??
        record?.id
    );
    const id = poolAddress ||
      String(record?.id ?? "").toLowerCase();
    if (id) {
      dedupedPools.set(id, record);
    }
  }

  const pools = [...dedupedPools.values()];
  const rawObservedDexes = [
    ...new Set(
      pools
        .map(record =>
          String(
            record?.relationships?.dex?.data?.id ??
              ""
          ).toLowerCase()
        )
        .filter(Boolean)
    )
  ].sort();

  const inventoryDexIds = normalizedInventory.map(
    dex => dex.dexId
  );
  const missingDexes = inventoryDexIds.filter(
    dexId => !rawObservedDexes.includes(dexId)
  );
  const warmupComplete =
    normalizedInventory.length > 0 &&
    missingDexSnapshots.length === 0 &&
    staleDexes.every(
      dexId => inventoryDexIds.includes(dexId)
    );
  const dexCoverageComplete =
    warmupComplete &&
    missingDexes.length === 0;

  const uniqueFreshDexes = [
    ...new Set(freshDexes)
  ];
  const uniqueStaleDexes = [
    ...new Set(staleDexes)
  ];
  const uniqueMissingSnapshots = [
    ...new Set(missingDexSnapshots)
  ];

  const stale =
    inventoryStale ||
    uniqueStaleDexes.length > 0 ||
    uniqueMissingSnapshots.length > 0;

  const provider = {
    name: "GeckoTerminal Monad DEX rotation",
    requestsThisScan:
      inventoryRequestsThisScan +
      poolRequestsThisScan,
    inventoryRequestsThisScan,
    poolRequestsThisScan,
    cached:
      inventoryRequestsThisScan === 0 &&
      poolRequestsThisScan === 0,
    stale,
    staleFrom:
      inventoryStaleFrom ??
      (uniqueStaleDexes.length > 0
        ? now
        : null),
    staleAgeMs:
      inventoryStaleFrom
        ? Math.max(
            0,
            now - inventoryStaleFrom
          )
        : 0,
    queryMode: "dex_inventory_rotation",
    inventoryDexCount:
      normalizedInventory.length,
    poolSnapshotCount:
      pools.length,
    availableDexes: normalizedInventory,
    refreshedDexes: [
      ...new Set(refreshedDexes)
    ],
    freshDexes: uniqueFreshDexes,
    staleDexes: uniqueStaleDexes,
    missingDexSnapshots: uniqueMissingSnapshots,
    rawObservedDexes,
    missingDexes,
    warmupComplete,
    dexCoverageComplete,
    inventoryCached,
    inventoryStale,
    inventoryStaleFrom,
    rotationMinutes: Math.ceil(
      normalizedInventory.length /
        Math.max(
          1,
          GECKO_DEXES_PER_SCAN
        )
    ),
    dexesPerScan: GECKO_DEXES_PER_SCAN,
    poolPagesPerDexRefresh:
      GECKO_POOL_PAGES_PER_DEX_REFRESH,
    poolSnapshotTtlMs:
      GECKO_DEX_POOL_CACHE_TTL_MS,
    inventoryTtlMs:
      GECKO_DEX_CACHE_TTL_MS,
    externalMarketDataRequired: false,
    errors: errors.length
      ? [...new Set(errors)]
      : undefined,
    note:
      "The inventory is the complete Monad DEX set returned by GeckoTerminal. " +
      "Six DEXes are refreshed sequentially per minute and their cached top pool " +
      "snapshots are retained, giving a full 27-DEX rotation in about five minutes " +
      "with one pool page per DEX. Exact on-chain quotes remain the profitability gate."
  };

  return { pools, provider };
}

function parseGeckoPool(
  record: any,
  assets: Map<string, ArbitrageAsset>
): PoolRecord | null {
  const a = record?.attributes ?? {};
  const relationships = record?.relationships ?? {};
  const baseMeta =
    record?.__baseTokenMeta?.attributes ??
    {};
  const quoteMeta =
    record?.__quoteTokenMeta?.attributes ??
    {};

  const base =
    addr(baseMeta?.address) ||
    addr(
      relationships?.base_token?.data?.id
    ) ||
    addr(a?.base_token_address);

  const quote =
    addr(quoteMeta?.address) ||
    addr(
      relationships?.quote_token?.data?.id
    ) ||
    addr(a?.quote_token_address);

  const nativeZero =
    "0x0000000000000000000000000000000000000000";

  // Never silently turn native MON into WMON. Native V4 pools require
  // an explicit wrap/unwrap leg, so they remain discovery-visible but are
  // excluded from the ERC20 arbitrage graph.
  if (
    !base ||
    !quote ||
    base === quote ||
    base === nativeZero ||
    quote === nativeZero
  ) {
    return null;
  }

  const existingBase = assets.get(base);
  const existingQuote = assets.get(quote);

  const baseAsset =
    existingBase ??
    {
      symbol: tokenSymbol(
        record?.__baseTokenMeta ??
          baseMeta,
        shortAddress(base)
      ),
      address: base,
      decimals: tokenDecimals(
        record?.__baseTokenMeta ??
          baseMeta
      )
    };

  const quoteAsset =
    existingQuote ??
    {
      symbol: tokenSymbol(
        record?.__quoteTokenMeta ??
          quoteMeta,
        shortAddress(quote)
      ),
      address: quote,
      decimals: tokenDecimals(
        record?.__quoteTokenMeta ??
          quoteMeta
      )
    };

  if (!existingBase) {
    assets.set(base, baseAsset);
  }
  if (!existingQuote) {
    assets.set(quote, quoteAsset);
  }

  const baseToQuote = num(
    a.base_token_price_quote_token
  );
  if (!(baseToQuote > 0)) return null;

  const dex = String(
    relationships?.dex?.data?.id ??
      record?.__dexMeta?.id ??
      ""
  ).toLowerCase();

  const quoteKind =
    classifyQuoteKind(
      String(
        a.address ??
          record?.id ??
          ""
      ),
      dex
    );

  const poolAddress = poolIdentifier(
    a.address ??
      record?.id
  );

  if (!poolAddress) return null;

  return {
    id: String(
      record?.id ??
        poolAddress
    ),
    name: String(
      a.name ??
        `${baseAsset.symbol}/${quoteAsset.symbol} ${dex}`
    ),
    address: poolAddress,
    base,
    quote,
    baseSymbol: baseAsset.symbol,
    quoteSymbol: quoteAsset.symbol,
    baseToQuote,
    feePct: inferV3FeePct(
      String(a.name ?? ""),
      num(
        a.pool_fee_percentage ??
          a.fee_percentage ??
          a.pool_fee
      )
    ),
    liquidityUsd: num(a.reserve_in_usd),
    volume24hUsd: num(
      a.volume_usd?.h24
    ),
    dex,
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
    kind === "pancake-v2" ||
    kind === "kuru"
  );
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
  cache?: LSTArbitrageCache
) {
  const assets = assetMap();
  const discovery = await discoverGeckoMonadDexPools(cache);

  const parsedPools = discovery.pools
    .map((record: any) => parseGeckoPool(record, assets))
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
        "Routes are built from the complete paginated Monad pool graph. " +
        "Only DEXs with a validated exact quote adapter are allowed into " +
        "profitability routing. Every exact leg consumes the actual output " +
        "of the prior leg."
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
