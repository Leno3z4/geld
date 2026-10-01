import { parseEventLogs, type Address } from "viem";
import { config, assertLiveConfig } from "./config.js";
import {
  clients,
  streamClient,
  ADDRESSES,
  curveAbi,
  erc20Abi,
  getBalance,
  getTokenBalance,
  getTokenBalances,
  quoteSells,
  getTokenDecimals,
  quoteBuy,
  quoteSell,
  buyNative,
  sellToNative,
  factoryAbi,
  nadFunPairAbi
} from "./nadfun.js";
import { StateStore } from "./store.js";
import { GeminiBrain } from "./ai.js";
import { SeasonalityModel, entryGateDiagnostics, positionExitSignal, scoreToken, selectEntryStrategy, shouldClose, shouldOpen, shouldWatch, updateMarketMetrics, curveProgressPct, isLowCapMomentumCandidate, lowCapMomentumBlockers, entrySizeVolatilityFactor, type EntryGateRules, type PositionExitRules } from "./strategy.js";
import type { BotState, Position, TokenSnapshot } from "./types.js";
import { formatUnits } from "viem";

type Listener = (state: BotState) => void;


function decodeNadfunPayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "string") return parsed;
    return decodeNadfunPayload(parsed);
  } catch {}

  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
    );
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function numeric(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function boolish(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function createdAtMs(value: unknown) {
  if (typeof value === "string" && Number.isNaN(Number(value))) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const n = numeric(value);
  if (!n) return 0;
  return n < 10_000_000_000 ? n * 1000 : n;
}

interface MarketResponse {
  market_info?: {
    holder_count?: number;
    price_native?: string;
    price_mon?: string;
    price?: string;
    price_quote?: string;
    price_usd?: string;
    token_price?: string;
    reserve_native?: string;
    reserve_quote?: string;
    reserve_token?: string;
    volume?: string;
    market_cap_usd?: string | number;
    marketCapUsd?: string | number;
    ath_price?: string;
    ath_price_usd?: string;
    market_type?: string;
    market_id?: string;
    pair?: string;
    pair_address?: string;
    quote_price?: string;
    native_price?: string;
    quote_info?: { quote_id?: string; symbol?: string; decimals?: number };
    is_locked?: boolean;
  };
  metrics?: Array<{
    timeframe?: string;
    percent?: number;
    transactions?: { buy?: number; sell?: number; total?: number };
    volume?: { buy?: string; sell?: string; total?: string };
    makers?: { buy?: number; sell?: number; total?: number };
  }>;
  token_info?: {
    name?: string;
    symbol?: string;
    is_graduated?: boolean;
    creator?: { account_id?: string };
  };
}

export class TradingEngine {
  readonly store = new StateStore();
  readonly brain = new GeminiBrain();
  readonly seasonality = new SeasonalityModel();

  private publicClient: any;
  private walletClient: any;
  private account: any;
  private listeners = new Set<Listener>();
  private unwatch: (() => void) | null = null;
  private pollTimer?: NodeJS.Timeout;
  private positionTimer?: NodeJS.Timeout;
  private aiTimer?: NodeJS.Timeout;
  private saveTimer?: NodeJS.Timeout;
  private lastBlock = 0n;
  private lastDexBlock = 0n;
  private pendingCandidates = new Set<string>();
  private reservedSpendMon = 0;

  constructor() {
    const c = clients();
    this.publicClient = c.publicClient;
    this.walletClient = c.walletClient;
    this.account = c.account;
  }

  onUpdate(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return this.store.get();
  }

  private emit() {
    for (const listener of this.listeners) listener(this.store.get());
  }

  private entryCircuitBreakerActive() {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const state = this.store.get();
    const equity = Math.max(0, state.balanceMon + state.openExposureMon);

    if (state.stats.dailyRiskDay !== today || !(state.stats.dailyRiskStartEquityMon! > 0)) {
      this.store.update((s) => {
        s.stats.dailyRiskDay = today;
        s.stats.dailyRiskStartEquityMon = equity;
        s.stats.dailyRiskDrawdownPct = 0;
        s.stats.entryCircuitBreakerUntil = undefined;
        s.stats.entryCircuitBreakerReason = undefined;
      });
      return false;
    }

    const startEquity = state.stats.dailyRiskStartEquityMon!;
    const drawdownPct = startEquity > 0 ? ((equity / startEquity) - 1) * 100 : 0;
    const nextDay = Date.parse(today + "T23:59:59.999Z") + 1;
    const triggered = drawdownPct <= -config.dailyLossLimitPct;
    const stillBlocked = (state.stats.entryCircuitBreakerUntil ?? 0) > now;

    this.store.update((s) => {
      s.stats.dailyRiskDrawdownPct = drawdownPct;
      if (triggered) {
        s.stats.entryCircuitBreakerUntil = nextDay;
        s.stats.entryCircuitBreakerReason =
          "DAILY_LOSS_LIMIT: " + drawdownPct.toFixed(2) + "%";
      }
    });

    return triggered || stillBlocked;
  }

  private cleanupStalePendingExecutions() {
    const cutoff = Date.now() - config.pendingExecutionTimeoutMs;
    const stale = Object.values(this.store.get().pendingExecutions).filter(
      (pending) => pending.createdAt < cutoff && !pending.txHash
    );

    if (stale.length === 0) return 0;

    this.store.update((s) => {
      for (const pending of stale) {
        delete s.pendingExecutions[pending.id];
      }
    });

    return stale.length;
  }

  async init() {
    await this.store.load();
    this.cleanupStalePendingExecutions();
    this.store.update((s) => {
      s.walletAddress = this.account?.address ?? "";
      s.liveTrading = config.liveTrading;
    });
    this.seasonality.hydrate(this.store.get().seasonality);

    if (this.account) {
      await this.refreshBalance();
      await this.reconcileWalletPositions();
      await this.refreshBalance();
    }
    this.emit();
  }

  async start() {
    if (this.store.get().running) return;

    assertLiveConfig();

    this.store.update((s) => {
      s.running = true;
      s.stats.startedAt ??= Date.now();
    });
    this.emit();

    await this.startEventSource();
    this.positionTimer = setInterval(() => void this.managePositions(), config.positionLoopMs);
    this.aiTimer = setInterval(() => void this.reviewOpenPositions(), config.aiPositionReviewMs);
    this.saveTimer = setInterval(() => void this.persist(), 10000);

    await this.persist();
  }

  private async discoverEstablishedTokens() {
    try {
      if (this.entryCircuitBreakerActive()) {
        this.store.update((s) => {
          s.stats.lastIdleReason = "ENTRY CIRCUIT BREAKER: daily loss limit reached; exits remain active";
        });
        return;
      }
      const url =
        config.nadfunApiUrl +
        "/order/market_cap?page=1&limit=" +
        config.discoveryLimit +
        "&is_nsfw=false";

      const headers = {
        accept: "application/json",
        ...(config.nadfunApiKey ? { "X-API-Key": config.nadfunApiKey } : {})
      };

      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error("NadFun market-cap discovery failed: HTTP " + response.status);

      const payload = decodeNadfunPayload(await response.text());
      const marketRows = Array.isArray(payload?.tokens) ? payload.tokens : [];

      // Market-cap alone misses the $8k-$25k lane because it is dominated by
      // higher-cap tokens. Pull newest tokens separately and merge the full
      // market objects so low-cap momentum candidates enter the same pipeline.
      let newestRows: any[] = [];
      if (config.lowCapMomentumEnabled) {
        const newestUrl =
          config.nadfunApiUrl +
          "/order/creation_time?page=1&limit=50&is_nsfw=false&direction=DESC";
        try {
          const newestResponse = await fetch(newestUrl, { headers });
          if (newestResponse.ok) {
            const newestPayload = decodeNadfunPayload(await newestResponse.text());
            newestRows = Array.isArray(newestPayload?.tokens) ? newestPayload.tokens : [];
          }
        } catch {}
      }

      const byToken = new Map<string, any>();
      for (const row of [...marketRows, ...newestRows]) {
        const address = String(row?.token_info?.token_id ?? row?.token_info?.token ?? row?.address ?? "").toLowerCase();
        if (/^0x[0-9a-f]{40}$/.test(address)) byToken.set(address, row);
      }
      const rows = [...byToken.values()];

      let watched = 0;
      let eligible = 0;
      const candidates: TokenSnapshot[] = [];
      const lowCapSeeds: TokenSnapshot[] = [];

      for (const row of rows) {
        const info = row?.token_info ?? {};
        const market = row?.market_info ?? {};
        const tokenAddress = String(info.token_id ?? info.token ?? row?.address ?? "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(tokenAddress)) continue;

        const createdAt = createdAtMs(info.created_at ?? info.createdAt);
        const reserveNative = numeric(market.reserve_native);
        const reserveToken = numeric(market.reserve_token);
        const priceMonFromReserve = reserveNative > 0 && reserveToken > 0
          ? reserveNative / reserveToken
          : 0;
        const priceMon = priceMonFromReserve ||
          numeric(market.price_native ?? market.price_mon ?? market.token_price);
        const liquidityMon = reserveNative > 0 ? reserveNative / 1e18 : 0;
        const volumeMonRaw = numeric(market.volume);
        const volumeMon = volumeMonRaw > 0 ? volumeMonRaw / 1e18 : 0;
        const marketPriceMon = numeric(market.price_native ?? market.price_mon ?? market.price);
        const marketPriceUsd = numeric(market.price_usd);
        const impliedMonUsd = marketPriceMon > 0 && marketPriceUsd > 0
          ? marketPriceUsd / marketPriceMon
          : 0;
        const liquidityUsd = liquidityMon > 0 && impliedMonUsd > 0
          ? liquidityMon * impliedMonUsd
          : 0;
        // NadFun tokens use a fixed 1B total supply; when the market API does
        // not provide an explicit market cap, derive FDV/market cap from price.
        const explicitMarketCapUsd = numeric(
          market.market_cap_usd ??
          market.marketCapUsd ??
          row?.market_cap_usd ??
          row?.marketCapUsd
        );
        const marketCapUsd = explicitMarketCapUsd > 0
          ? explicitMarketCapUsd
          : marketPriceUsd > 0
            ? marketPriceUsd * 1_000_000_000
            : 0;
        const marketCapMon = impliedMonUsd > 0
          ? marketCapUsd / impliedMonUsd
          : priceMon > 0
            ? priceMon * 1_000_000_000
            : 0;
        const holders = Math.max(0, Math.floor(numeric(market.holder_count ?? market.holders)));
        const graduated = boolish(info.is_graduated, market.market_type === "DEX");

        const existing = this.store.get().tokens[tokenAddress];

        const token: TokenSnapshot = existing ?? {
          token: tokenAddress,
          symbol: String(info.symbol ?? "?"),
          name: String(info.name ?? info.symbol ?? "Unknown"),
          creator: String(info.creator?.account_id ?? info.creator ?? ""),
          pair: String(info.pair ?? market.pair ?? market.pair_address ?? row?.pair ?? ""),
          quoteToken: String(info.quote_token ?? ""),
          createdBlock: String(info.created_block ?? ""),
          virtualTokenStart: undefined,
          virtualTokenReserve: undefined,
          minTokenReserve: undefined,
          createdAt: createdAt || Date.now(),
          lastEventAt: Date.now(),
          buys: 0,
          sells: 0,
          buyMon: 0,
          sellMon: 0,
          progressPct: 100,
          graduated,
          locked: boolish(info.is_locked, boolish(market.is_locked)),
          holders: 0,
          volumeUsd: 0,
          priceUsd: 0,
          priceMon: 0,
          peakPriceMon: 0,
          localScore: 0,
          liquidityUsd: 0,
          monUsdPrice: 0
        };

        if (createdAt > 0) token.createdAt = createdAt;
        token.name = String(info.name ?? token.name);
        token.symbol = String(info.symbol ?? token.symbol);
        token.creator = String(info.creator?.account_id ?? info.creator ?? token.creator);
        token.graduated = graduated;
        token.locked = boolish(info.is_locked, boolish(market.is_locked, token.locked));
        token.marketType = market.market_type === "DEX" || graduated ? "DEX" : "BONDING_CURVE";
        token.liquidityMon = liquidityMon || token.liquidityMon || 0;
        token.monUsdPrice = impliedMonUsd || token.monUsdPrice || 0;
        token.liquidityUsd = liquidityUsd || token.liquidityUsd || 0;
        token.volumeMon = volumeMon || token.volumeMon || 0;
        token.volumeUsd = (token.volumeMon ?? 0) * (token.monUsdPrice ?? impliedMonUsd ?? 0);
        token.holders = holders || token.holders || 0;
        token.marketCapUsd = marketCapUsd || token.marketCapUsd || 0;
        token.marketCapMon = marketCapMon || token.marketCapMon || 0;
        token.changePct = numeric(row?.percent ?? market.percent ?? token.changePct);
        token.priceMon = priceMon || marketPriceMon || token.priceMon || 0;
        token.priceUsd = numeric(market.price_usd ?? token.priceUsd);

        const athPriceUsd = numeric(market.ath_price ?? token.athPriceUsd);
        if (athPriceUsd > 0) {
          token.athPriceUsd = athPriceUsd;
          if ((token.monUsdPrice ?? 0) > 0) {
            token.athPriceMon = athPriceUsd / token.monUsdPrice!;
          }
        }

        const marketPair = String(
          info.pair ??
          market.pair ??
          market.pair_address ??
          row?.pair ??
          ""
        );
        if (/^0x[0-9a-fA-F]{40}$/.test(marketPair)) {
          token.pair = marketPair.toLowerCase();
        }

        token.lastMarketAt = Date.now();

        if (token.priceMon > 0) {
          const history = token.priceHistory ?? [];
          const previous = history.at(-1);
          if (!previous || Date.now() - previous.ts >= config.priceSampleMs) {
            history.push({ ts: Date.now(), priceMon: token.priceMon });
            token.priceHistory = history.slice(-300);
            if (previous && previous.priceMon > 0) {
              const sampleReturn = (token.priceMon / previous.priceMon - 1) * 100;
              this.seasonality.observeReturn(Date.now(), sampleReturn);
            }
          }
        }

        updateMarketMetrics(token);
        token.localScore = scoreToken(token, this.seasonality);
        token.entryStrategy = selectEntryStrategy(token, config.dailyMinSamples, config.minVolume5mUsd);

        const ageMinutesForLowCap = Math.max(0, (Date.now() - token.createdAt) / 60000);
        const lowCapBaseCandidate =
          config.lowCapMomentumEnabled &&
          token.marketCapUsd !== undefined &&
          token.marketCapUsd >= config.lowCapMinMarketCapUsd &&
          token.marketCapUsd <= config.lowCapMaxMarketCapUsd &&
          (token.liquidityUsd ?? 0) >= config.lowCapMinLiquidityUsd &&
          (token.holders ?? 0) >= config.lowCapMinHolders &&
          (token.volumeUsd ?? 0) >= config.lowCapMinVolumeUsd &&
          ageMinutesForLowCap >= config.lowCapMinAgeMinutes &&
          (token.trendPct1h ?? token.changePct ?? 0) >= config.lowCapMinTrend1hPct &&
          token.localScore >= config.lowCapMinScore;

        const watchable = shouldWatch(
          token,
          config.minLiquidityUsd,
          config.minMarketCapUsd,
          config.minHolders,
          config.minVolumeUsd
        );

        const entryRules: EntryGateRules = {
          minEstablishedAgeMinutes: config.minEstablishedAgeMinutes,
          minLiquidityUsd: config.minLiquidityUsd,
          minMarketCapUsd: config.minMarketCapUsd,
          minHolders: config.minHolders,
          minVolumeUsd: config.minVolumeUsd,
          dipMinPct: config.dipMinPct,
          dipMaxPct: config.dipMaxPct,
          recoveryMinPct: config.recoveryMinPct,
          trendMax1hPct: config.trendMax1hPct,
          minTrend4hPct: config.minTrend4hPct,
          minLocalScore: config.minLocalScore
        };
        const diagnostics = entryGateDiagnostics(token, entryRules);
        token.entryDiagnostics = diagnostics;

        if (lowCapBaseCandidate) {
          token.watchReason = "Watching: low-cap flow metrics pending";
          lowCapSeeds.push(token);
          watched += 1;
        } else if (!watchable) {
          token.watchReason = `Watching: ${diagnostics.primary}`;
        } else if (diagnostics.blockers.length > 0) {
          token.watchReason = `Watching: ${diagnostics.primary}`;
          watched += 1;
        } else {
          token.watchReason = "ENTRY SETUP: established candidate; awaiting AI";
          eligible += 1;
          watched += 1;
        }

        this.store.upsertToken(token);

        const entrySetup = lowCapBaseCandidate || diagnostics.blockers.length === 0;
        if (entrySetup) candidates.push(token);
        token.lastEnrichedAt = Date.now();
      }

      await this.resolveDexPairs(
        Object.values(this.store.get().tokens).filter((token) => token.graduated)
      );

      // Pull precise 5-minute USD flow for only the strongest low-cap seeds.
      // Nad.fun's documented swap-history values are USD-denominated, which
      // lets us compute both the current and previous 5m windows exactly.
      for (const token of lowCapSeeds
        .sort((a, b) =>
          (b.localScore - a.localScore) ||
          ((b.volumeUsd ?? 0) - (a.volumeUsd ?? 0)) ||
          ((b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
        )
        .slice(0, config.lowCapFlowApiCandidateLimit)) {
        await this.enrichFlowMetrics(token);
        const lowCapMomentum = isLowCapMomentumCandidate(token, {
          enabled: config.lowCapMomentumEnabled,
          minMarketCapUsd: config.lowCapMinMarketCapUsd,
          maxMarketCapUsd: config.lowCapMaxMarketCapUsd,
          minLiquidityUsd: config.lowCapMinLiquidityUsd,
          minHolders: config.lowCapMinHolders,
          minVolumeUsd: config.lowCapMinVolumeUsd,
          minAgeMinutes: config.lowCapMinAgeMinutes,
          minBuySellRatio5m: config.lowCapMinBuySellRatio5m,
          minVolume5mUsd: config.lowCapMinVolume5mUsd,
          minVolumeAcceleration5m: config.lowCapMinVolumeAcceleration5m,
          minTrend1hPct: config.lowCapMinTrend1hPct,
          minLocalScore: config.lowCapMinScore
        });
        if (lowCapMomentum && !candidates.includes(token)) {
          candidates.push(token);
          eligible += 1;
          token.watchReason = "ENTRY SETUP: low-cap momentum; awaiting AI";
        } else if (!lowCapMomentum) {
          const blockers = lowCapMomentumBlockers(token, {
            enabled: config.lowCapMomentumEnabled,
            minMarketCapUsd: config.lowCapMinMarketCapUsd,
            maxMarketCapUsd: config.lowCapMaxMarketCapUsd,
            minLiquidityUsd: config.lowCapMinLiquidityUsd,
            minHolders: config.lowCapMinHolders,
            minVolumeUsd: config.lowCapMinVolumeUsd,
            minAgeMinutes: config.lowCapMinAgeMinutes,
            minBuySellRatio5m: config.lowCapMinBuySellRatio5m,
            minVolume5mUsd: config.lowCapMinVolume5mUsd,
            minVolumeAcceleration5m: config.lowCapMinVolumeAcceleration5m,
            minTrend1hPct: config.lowCapMinTrend1hPct,
            minLocalScore: config.lowCapMinScore
          });
          token.watchReason = blockers.length
            ? "LOW-CAP BLOCKED: " + blockers.slice(0, 2).join("; ")
            : "LOW-CAP BLOCKED";
        }
        this.store.upsertToken(token);
      }

      for (const token of candidates
        .sort((a, b) =>
          (b.localScore - a.localScore) ||
          ((b.liquidityMon ?? 0) - (a.liquidityMon ?? 0)) ||
          ((b.volumeMon ?? 0) - (a.volumeMon ?? 0))
        )
        .slice(0, config.aiCandidateLimit)) {
        await this.maybeEvaluateCandidate(token);
      }

      this.store.update((s) => {
        s.stats.lastDiscoveryAt = Date.now();
        s.stats.discoveredTokens = rows.length;
        s.stats.watchedTokens = watched;
        s.stats.eligibleCandidates = eligible;
        s.seasonality = this.seasonality.export();
      });
    } catch (error) {
      this.store.update((s) => {
        s.stats.lastError = error instanceof Error ? error.message : String(error);
        s.stats.lastDiscoveryAt = Date.now();
      });
    }
  }

  async startScheduled() {
    assertLiveConfig();

    if (!this.store.get().running) {
      this.store.update((s) => {
        s.running = true;
        s.stats.startedAt ??= Date.now();
      });
      this.emit();
    }

    await this.runScheduledCycle();
  }

  async runRiskCycle() {
    if (!this.store.get().running) return;

    this.cleanupStalePendingExecutions();
    await this.reconcileWalletPositions();
    await this.managePositions();

    this.store.update((s) => {
      s.stats.lastRiskCycleAt = Date.now();
    });
    await this.persist();
  }

  async runScheduledCycle() {
    if (!this.store.get().running) return;

    assertLiveConfig();

    const persistedBlock = this.store.get().stats.lastProcessedBlock;

    if (this.lastBlock === 0n) {
      const latest = await this.publicClient.getBlockNumber();
      const stats = this.store.get().stats;
      const needsBackfill = !stats.eventBackfillDone && stats.eventCount === 0 && Object.keys(this.store.get().tokens).length === 0;

      if (needsBackfill) {
        this.lastBlock = latest > BigInt(config.eventBackfillBlocks)
          ? latest - BigInt(config.eventBackfillBlocks)
          : 0n;
      } else if (persistedBlock) {
        this.lastBlock = BigInt(persistedBlock);
      } else {
        this.lastBlock = latest;
      }

      if (needsBackfill) {
        this.store.update((s) => {
          s.stats.eventBackfillDone = true;
        });
      }
    }

    // Drop abandoned pre-transaction reservations before counting pending BUY slots.\n    // A Worker restart can otherwise leave persisted pending BUYs forever and\n    // block every new entry even though no position exists on-chain.\n    this.cleanupStalePendingExecutions();\n\n    // Reconcile wallet assets before risk management. A confirmed BUY must
    // never disappear from the internal book just because the process died
    // between settlement and state persistence.
    await this.reconcileWalletPositions();

    // Exit/risk management gets first priority on the one-minute Worker cycle.
    // Discovery must never delay a protective sell on an existing position.
    await this.managePositions();
    this.entryCircuitBreakerActive();
    await this.discoverEstablishedTokens();
    await this.pollLogs();
    await this.pollDexLogs();
    await this.reviewOpenPositions();

    this.store.update((s) => {
      s.stats.lastCycleAt = Date.now();
      s.stats.lastProcessedBlock = this.lastBlock.toString();
    });

    await this.persist();
  }

  async stop() {
    this.store.update((s) => {
      s.running = false;
    });

    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.positionTimer) clearInterval(this.positionTimer);
    if (this.aiTimer) clearInterval(this.aiTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);

    this.pollTimer = undefined;
    this.positionTimer = undefined;
    this.aiTimer = undefined;
    this.saveTimer = undefined;

    await this.persist();
    this.emit();
  }

  async sellAll() {
    for (const position of Object.values(this.store.get().positions).filter((p) => p.status === "OPEN")) {
      await this.closePosition(position, "MANUAL_SELL_ALL");
    }
    await this.persist();
  }

  private async startEventSource() {
    const ws = streamClient();

    if (ws) {
      this.unwatch = ws.watchContractEvent({
        address: ADDRESSES.CURVE,
        abi: curveAbi,
        onLogs: (logs: any[]) => {
          for (const log of logs) void this.handleLog(log);
        }
      });
      return;
    }

    this.lastBlock = await this.publicClient.getBlockNumber();
    this.pollTimer = setInterval(() => void this.pollLogs(), config.eventPollMs);
  }

  private async pollLogs() {
    try {
      const latest = await this.publicClient.getBlockNumber();
      if (latest <= this.lastBlock) {
        this.store.update((s) => {
          s.stats.lastLogCount = 0;
          s.stats.lastLogPollAt = Date.now();
        });
        return;
      }

      const eventAbi = curveAbi.filter((item: any) => item.type === "event");
      let cursor = this.lastBlock + 1n;
      let totalLogs = 0;

      const rpcRange = Math.min(100, config.logChunkBlocks);
      for (let chunk = 0; chunk < config.maxLogChunksPerCycle && cursor <= latest; chunk += 1) {
        const to = latest > cursor + BigInt(rpcRange - 1)
          ? cursor + BigInt(rpcRange - 1)
          : latest;

        const logs = await this.publicClient.getLogs({
          address: ADDRESSES.CURVE,
          events: eventAbi,
          fromBlock: cursor,
          toBlock: to
        });

        totalLogs += logs.length;
        for (const log of logs) await this.handleLog(log);

        this.lastBlock = to;
        cursor = to + 1n;
      }

      this.store.update((s) => {
        s.stats.lastProcessedBlock = this.lastBlock.toString();
        s.stats.lastLogCount = totalLogs;
        s.stats.lastLogPollAt = Date.now();
        s.stats.lastError = undefined;
      });
    } catch (error) {
      this.store.update((s) => {
        s.stats.lastError = error instanceof Error ? error.message : String(error);
        s.stats.lastLogPollAt = Date.now();
      });
    }
  }

  private async pollDexLogs() {
    try {
      const latest = await this.publicClient.getBlockNumber();

      if (this.lastDexBlock === 0n) {
        const persisted = this.store.get().stats.lastDexProcessedBlock;
        this.lastDexBlock = persisted
          ? BigInt(persisted)
          : latest > BigInt(config.eventBackfillBlocks)
            ? latest - BigInt(config.eventBackfillBlocks)
            : 0n;
      }

      const pairMap = new Map<string, { token: TokenSnapshot; token0: string; token1: string }>();

      for (const token of Object.values(this.store.get().tokens)) {
        if (!token.graduated || !/^0x[0-9a-f]{40}$/.test(token.pair)) continue;
        if (
          !/^0x[0-9a-f]{40}$/.test(token.pairToken0 ?? "") ||
          !/^0x[0-9a-f]{40}$/.test(token.pairToken1 ?? "")
        ) continue;

        pairMap.set(token.pair.toLowerCase(), {
          token,
          token0: token.pairToken0!,
          token1: token.pairToken1!
        });
      }

      if (!pairMap.size || latest <= this.lastDexBlock) {
        this.store.update((s) => {
          s.stats.lastDexLogCount = 0;
          s.stats.lastDexLogPollAt = Date.now();
          s.stats.lastDexProcessedBlock = this.lastDexBlock.toString();
        });
        return;
      }

      const pairs = [...pairMap.keys()] as Address[];
      const eventAbi = nadFunPairAbi.filter((item: any) => item.type === "event");
      let cursor = this.lastDexBlock + 1n;
      let totalLogs = 0;
      const rpcRange = Math.min(100, config.logChunkBlocks);

      for (let chunk = 0; chunk < config.maxLogChunksPerCycle && cursor <= latest; chunk += 1) {
        const to = latest > cursor + BigInt(rpcRange - 1)
          ? cursor + BigInt(rpcRange - 1)
          : latest;

        const logs = await this.publicClient.getLogs({
          address: pairs,
          events: eventAbi,
          fromBlock: cursor,
          toBlock: to
        });

        totalLogs += logs.length;

        for (const log of logs) {
          const parsed: any = parseEventLogs({
            abi: nadFunPairAbi,
            logs: [log]
          })[0];
          if (!parsed || parsed.eventName !== "Swap") continue;

          const pairAddress = String(log.address ?? "").toLowerCase();
          const meta = pairMap.get(pairAddress);
          if (!meta) continue;

          const args = parsed.args as any;
          const tokenIs0 = meta.token0 === meta.token.token.toLowerCase();
          const tokenIs1 = meta.token1 === meta.token.token.toLowerCase();
          const quoteIs0 = meta.token0 === ADDRESSES.WMON.toLowerCase();
          const quoteIs1 = meta.token1 === ADDRESSES.WMON.toLowerCase();

          if ((!tokenIs0 && !tokenIs1) || (!quoteIs0 && !quoteIs1)) continue;

          const quoteIn = quoteIs0 ? BigInt(args.amount0In) : BigInt(args.amount1In);
          const quoteOut = quoteIs0 ? BigInt(args.amount0Out) : BigInt(args.amount1Out);
          const baseIn = tokenIs0 ? BigInt(args.amount0In) : BigInt(args.amount1In);
          const baseOut = tokenIs0 ? BigInt(args.amount0Out) : BigInt(args.amount1Out);

          const now = Date.now();

          if (quoteIn > 0n && baseOut > 0n) {
            const amount = Number(formatUnits(quoteIn, 18));
            if (Number.isFinite(amount) && amount > 0) {
              meta.token.buys += 1;
              meta.token.buyMon += amount;
              meta.token.flowHistory = [
                ...(meta.token.flowHistory ?? []),
                { ts: now, buyMon: amount, sellMon: 0 }
              ].slice(-240);
              this.seasonality.observe(now, amount, 0);
            }
          } else if (baseIn > 0n && quoteOut > 0n) {
            const amount = Number(formatUnits(quoteOut, 18));
            if (Number.isFinite(amount) && amount > 0) {
              meta.token.sells += 1;
              meta.token.sellMon += amount;
              meta.token.flowHistory = [
                ...(meta.token.flowHistory ?? []),
                { ts: now, buyMon: 0, sellMon: amount }
              ].slice(-240);
              this.seasonality.observe(now, 0, amount);
            }
          }

          meta.token.lastEventAt = now;
          updateMarketMetrics(meta.token);
          meta.token.localScore = scoreToken(meta.token, this.seasonality);
          this.store.upsertToken(meta.token);
        }

        this.lastDexBlock = to;
        cursor = to + 1n;
      }

      this.store.update((s) => {
        s.stats.eventCount += totalLogs;
        s.stats.lastDexLogCount = totalLogs;
        s.stats.lastDexLogPollAt = Date.now();
        s.stats.lastDexProcessedBlock = this.lastDexBlock.toString();
        s.seasonality = this.seasonality.export();
      });
    } catch (error) {
      this.store.update((s) => {
        s.stats.lastDexLogPollAt = Date.now();
        s.stats.lastError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private async handleLog(log: any) {
    this.store.update((s) => {
      s.stats.eventCount += 1;
    });

    try {
      const parsed: any = parseEventLogs({
        abi: curveAbi,
        logs: [log]
      })[0];

      if (!parsed) return;

      const args = parsed.args as any;
      const tokenAddress = String(args.token).toLowerCase();
      const now = Date.now();

      if (parsed.eventName === "Create") {
        const token: TokenSnapshot = {
          token: tokenAddress,
          symbol: String(args.symbol ?? "?"),
          name: String(args.name ?? args.symbol ?? "Unknown"),
          creator: String(args.creator ?? ""),
          pair: String(args.pair ?? ""),
          quoteToken: String(args.quoteToken ?? "").toLowerCase(),
          createdBlock: log.blockNumber?.toString(),
          virtualTokenStart: String(args.virtualTokenReserve ?? "0"),
          virtualTokenReserve: String(args.virtualTokenReserve ?? "0"),
          minTokenReserve: String(args.minTokenReserve ?? "0"),
          createdAt: now,
          lastEventAt: now,
          buys: 0,
          sells: 0,
          buyMon: 0,
          sellMon: 0,
          progressPct: 0,
          graduated: false,
          locked: false,
          holders: 0,
          volumeUsd: 0,
          priceUsd: 0,
          priceMon: 0,
          peakPriceMon: 0,
          localScore: 0,
          lastCandidateAiAt: 0
        };

        await this.enrichToken(token);
        token.progressPct = curveProgressPct(token);
        token.localScore = scoreToken(token, this.seasonality);
        this.store.upsertToken(token);
        this.emit();

        // A fresh Create event has no flow yet; the first Buy/Sync event will
        // re-score it and can trigger an AI evaluation.
        return;
      }

      const token = this.store.get().tokens[tokenAddress];
      if (!token) return;

      token.lastEventAt = now;

      if (parsed.eventName === "Buy") {
        const amount = Number(formatUnits(args.quoteIn as bigint, 18));
        token.buys += 1;
        token.buyMon += amount;
        token.flowHistory = [...(token.flowHistory ?? []), { ts: now, buyMon: amount, sellMon: 0 }].slice(-240);
        this.seasonality.observe(now, amount, 0);
      } else if (parsed.eventName === "Sell") {
        const amount = Number(formatUnits(args.quoteOut as bigint, 18));
        token.sells += 1;
        token.sellMon += amount;
        token.flowHistory = [...(token.flowHistory ?? []), { ts: now, buyMon: 0, sellMon: amount }].slice(-240);
        this.seasonality.observe(now, 0, amount);
      } else if (parsed.eventName === "Graduate") {
        token.graduated = true;
      } else if (parsed.eventName === "Sync") {
        token.virtualTokenReserve = String(args.virtualTokenReserve ?? token.virtualTokenReserve ?? "0");
        token.progressPct = curveProgressPct(token);
      }

      token.progressPct = curveProgressPct(token);
      updateMarketMetrics(token);
      token.localScore = scoreToken(token, this.seasonality);

      this.store.upsertToken(token);
      this.store.update((s) => {
        s.seasonality = this.seasonality.export();
      });
      this.emit();

      if (
        (parsed.eventName === "Buy" || parsed.eventName === "Sell" || parsed.eventName === "Sync") &&
        this.store.get().running &&
        token.localScore >= config.minLocalScore &&
        (Date.now() - token.createdAt) / 1000 <= (isLowCapMomentumCandidate(token, { enabled: config.lowCapMomentumEnabled, minMarketCapUsd: config.lowCapMinMarketCapUsd, maxMarketCapUsd: config.lowCapMaxMarketCapUsd, minLiquidityUsd: config.lowCapMinLiquidityUsd, minHolders: config.lowCapMinHolders, minVolumeUsd: config.lowCapMinVolumeUsd, minAgeMinutes: config.lowCapMinAgeMinutes, minBuySellRatio5m: config.lowCapMinBuySellRatio5m, minVolume5mUsd: config.lowCapMinVolume5mUsd, minVolumeAcceleration5m: config.lowCapMinVolumeAcceleration5m, minTrend1hPct: config.lowCapMinTrend1hPct, minLocalScore: config.lowCapMinScore }) ? config.lowCapCandidateMaxAgeSeconds : config.candidateMaxAgeSeconds)
      ) {
        void this.maybeEvaluateCandidate(token);
      }
    } catch (error) {
      this.store.update((s) => {
        s.stats.lastError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private async enrichFlowMetrics(token: TokenSnapshot) {
    const now = Date.now();
    if (now - (token.lastFlowApiAt ?? 0) < config.flowApiRefreshMs) return;

    try {
      const headers = {
        accept: "application/json",
        ...(config.nadfunApiKey ? { "X-API-Key": config.nadfunApiKey } : {})
      };

      const [historyResponse, metricsResponse] = await Promise.all([
        fetch(
          config.nadfunApiUrl + "/trade/swap-history/" + token.token + "?page=1&limit=100&direction=DESC",
          { headers }
        ),
        fetch(
          config.nadfunApiUrl + "/trade/metrics/" + token.token + "?timeframes=1,5,15,30,60",
          { headers }
        )
      ]);

      if (!historyResponse.ok && !metricsResponse.ok) {
        throw new Error(
          "NadFun flow endpoints failed: swap-history=" +
          historyResponse.status + " metrics=" + metricsResponse.status
        );
      }

      let buy5Usd = 0;
      let sell5Usd = 0;
      let buyPrev5Usd = 0;
      let sellPrev5Usd = 0;

      if (historyResponse.ok) {
        const payload = decodeNadfunPayload(await historyResponse.text());
        const swaps = Array.isArray(payload?.swaps) ? payload.swaps : [];
        const fiveAgo = now - 5 * 60 * 1000;
        const tenAgo = now - 10 * 60 * 1000;

        for (const swap of swaps) {
          const info = swap?.swap_info ?? {};
          const ts = createdAtMs(info.created_at);
          const valueUsd = numeric(info.value);
          if (!(ts > tenAgo) || !(valueUsd > 0)) continue;

          const eventType = String(info.event_type).toUpperCase();
          if (ts > fiveAgo) {
            if (eventType === "BUY") buy5Usd += valueUsd;
            else if (eventType === "SELL") sell5Usd += valueUsd;
          } else {
            if (eventType === "BUY") buyPrev5Usd += valueUsd;
            else if (eventType === "SELL") sellPrev5Usd += valueUsd;
          }
        }
      }

      let apiTrend5mPct: number | undefined;
      let apiTrend15mPct: number | undefined;
      let apiTrend1hPct: number | undefined;
      let metrics5mBuyUsd: number | undefined;
      let metrics5mSellUsd: number | undefined;
      let metrics5mBuyTx: number | undefined;
      let metrics5mSellTx: number | undefined;
      if (metricsResponse.ok) {
        const payload = decodeNadfunPayload(await metricsResponse.text());
        const metrics = Array.isArray(payload?.metrics) ? payload.metrics : [];
        const byTimeframe = new Map(metrics.map((metric: any) => [String(metric?.timeframe), metric]));

        const metric15 = byTimeframe.get("15");
        const metric60 = byTimeframe.get("60");
        const metric5 = byTimeframe.get("5");

        apiTrend5mPct = Number(metric5?.percent);
        apiTrend15mPct = Number(metric15?.percent);
        apiTrend1hPct = Number(metric60?.percent);

        const apiBuy5 = numeric(metric5?.volume?.buy);
        const apiSell5 = numeric(metric5?.volume?.sell);
        if (Number.isFinite(apiBuy5) && Number.isFinite(apiSell5)) {
          metrics5mBuyUsd = apiBuy5;
          metrics5mSellUsd = apiSell5;
          metrics5mBuyTx = numeric(metric5?.transactions?.buy);
          metrics5mSellTx = numeric(metric5?.transactions?.sell);

          // The metrics endpoint is authoritative for the current 5m window.
          buy5Usd = apiBuy5;
          sell5Usd = apiSell5;
        }
      }

      const volume5mUsd = buy5Usd + sell5Usd;
      const volumePrev5mUsd = buyPrev5Usd + sellPrev5Usd;
      const quoteUsd = token.monUsdPrice ?? 0;

      if (quoteUsd > 0) {
        token.volume5mMon = volume5mUsd / quoteUsd;
        token.volumePrev5mMon = volumePrev5mUsd / quoteUsd;
      } else {
        token.volume5mMon = 0;
        token.volumePrev5mMon = 0;
      }

      token.buySellRatio5m = volume5mUsd > 0
        ? buy5Usd / Math.max(0.01, sell5Usd)
        : 0;
      token.volumeAcceleration5m = volumePrev5mUsd > 0
        ? volume5mUsd / volumePrev5mUsd
        : volume5mUsd > 0 ? 2 : 0;

      if (apiTrend5mPct !== undefined && Number.isFinite(apiTrend5mPct)) {
        token.apiTrend5mPct = apiTrend5mPct;
      }
      if (apiTrend15mPct !== undefined && Number.isFinite(apiTrend15mPct)) {
        token.apiTrend15mPct = apiTrend15mPct;
      }
      if (apiTrend1hPct !== undefined && Number.isFinite(apiTrend1hPct)) {
        token.apiTrend1hPct = apiTrend1hPct;
      }
      if (metrics5mBuyUsd !== undefined) token.apiBuy5mUsd = metrics5mBuyUsd;
      if (metrics5mSellUsd !== undefined) token.apiSell5mUsd = metrics5mSellUsd;
      if (metrics5mBuyTx !== undefined) token.apiBuyTx5m = metrics5mBuyTx;
      if (metrics5mSellTx !== undefined) token.apiSellTx5m = metrics5mSellTx;
      token.apiVolume5mUsd = volume5mUsd;

      token.lastFlowApiAt = now;
      updateMarketMetrics(token);
      token.localScore = scoreToken(token, this.seasonality);
    } catch {
      // Preserve the on-chain flow fallback when the API is unavailable.
    }
  }

  private async enrichToken(token: TokenSnapshot) {
    const lastEnrichedAt = token.lastEnrichedAt ?? 0;
    if (Date.now() - lastEnrichedAt < 30000) return;

    token.lastEnrichedAt = Date.now();

    try {
      const endpoints = [
        config.nadfunApiUrl + "/trade/market/" + token.token,
        config.nadfunApiUrl + "/agent/market/" + token.token
      ];

      let payload: MarketResponse | null = null;
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            headers: {
              accept: "application/json",
              ...(config.nadfunApiKey ? { "X-API-Key": config.nadfunApiKey } : {})
            }
          });
          if (!response.ok) continue;
          payload = decodeNadfunPayload(await response.text()) as MarketResponse | null;
          if (payload) break;
        } catch {}
      }

      if (!payload) return;
      token.holders = payload.market_info?.holder_count ?? token.holders;
      token.priceUsd = numeric(
        payload.market_info?.price_usd ??
        payload.market_info?.token_price ??
        token.priceUsd
      );
      const reserveNative = numeric(payload.market_info?.reserve_native);
      const reserveToken = numeric(payload.market_info?.reserve_token);
      const marketPriceMon = numeric(
        payload.market_info?.price_native ??
        payload.market_info?.price_quote ??
        payload.market_info?.price_mon ??
        payload.market_info?.price ??
        payload.market_info?.token_price
      );
      const quotePriceUsd = numeric(
        payload.market_info?.quote_price ??
        payload.market_info?.native_price ??
        token.monUsdPrice
      );
      token.priceMon = reserveToken > 0 && reserveNative > 0
        ? reserveNative / reserveToken
        : marketPriceMon || token.priceMon;
      token.peakPriceMon = Math.max(token.peakPriceMon, token.priceMon);

      if (quotePriceUsd > 0) token.monUsdPrice = quotePriceUsd;
      if (reserveNative > 0) token.liquidityMon = reserveNative / 1e18;
      if ((token.liquidityMon ?? 0) > 0 && (token.monUsdPrice ?? 0) > 0) {
        token.liquidityUsd = token.liquidityMon! * token.monUsdPrice!;
      }

      token.volumeMon = Number.isFinite(Number(payload.market_info?.volume))
        ? Number(payload.market_info?.volume) / 1e18
        : token.volumeMon;
      token.volumeUsd = (token.volumeMon ?? 0) * (token.monUsdPrice ?? 0);

      const enrichedMarketCapUsd = numeric(
        payload.market_info?.market_cap_usd ??
        payload.market_info?.marketCapUsd ??
        token.marketCapUsd
      );
      if (enrichedMarketCapUsd > 0) {
        token.marketCapUsd = enrichedMarketCapUsd;
      } else if (token.priceUsd > 0) {
        token.marketCapUsd = token.priceUsd * 1_000_000_000;
      }
      const marketCapUsd = token.marketCapUsd ?? 0;
      if (marketCapUsd > 0 && (token.monUsdPrice ?? 0) > 0) {
        token.marketCapMon = marketCapUsd / token.monUsdPrice!;
      }

      const enrichedPair = String(
        payload.market_info?.pair ??
        payload.market_info?.pair_address ??
        ""
      );
      if (/^0x[0-9a-fA-F]{40}$/.test(enrichedPair)) {
        token.pair = enrichedPair.toLowerCase();
      }

      const enrichedAthUsd = numeric(payload.market_info?.ath_price ?? token.athPriceUsd);
      if (enrichedAthUsd > 0) {
        token.athPriceUsd = enrichedAthUsd;
        if ((token.monUsdPrice ?? 0) > 0) {
          token.athPriceMon = enrichedAthUsd / token.monUsdPrice!;
        }
      }

      token.graduated = payload.token_info?.is_graduated ?? token.graduated;
      token.symbol = payload.token_info?.symbol ?? token.symbol;
      token.name = payload.token_info?.name ?? token.name;
      token.creator = payload.token_info?.creator?.account_id ?? token.creator;
      if (payload.market_info?.market_type) {
        token.marketType =
          payload.market_info.market_type === "DEX" ||
          payload.market_info.market_type === "V2_DEX" ||
          token.graduated
            ? "DEX"
            : "BONDING_CURVE";
      }
      const quoteId = payload.market_info?.quote_info?.quote_id;
      if (quoteId) token.quoteToken = quoteId.toLowerCase();
    } catch {
      // On-chain signals remain authoritative when optional API enrichment fails.
    }
  }

  private async resolveDexPairs(tokens: TokenSnapshot[]) {
    const dexTokens = tokens.filter((token) => token.graduated);
    const missingPair = dexTokens.filter(
      (token) =>
        !/^0x[0-9a-f]{40}$/.test(token.pair) ||
        token.pair === "0x0000000000000000000000000000000000000000"
    );

    if (missingPair.length) {
      try {
        const results = await this.publicClient.multicall({
          contracts: missingPair.map((token) => ({
            address: ADDRESSES.FACTORY,
            abi: factoryAbi,
            functionName: "getPair",
            args: [token.token as Address, ADDRESSES.WMON]
          }))
        });

        results.forEach((result: any, index: number) => {
          const pair = typeof result.result === "string" ? result.result.toLowerCase() : "";
          if (
            /^0x[0-9a-f]{40}$/.test(pair) &&
            pair !== "0x0000000000000000000000000000000000000000"
          ) {
            missingPair[index].pair = pair;
          }
        });
      } catch {}
    }

    const needsMeta = dexTokens.filter(
      (token) =>
        /^0x[0-9a-f]{40}$/.test(token.pair) &&
        token.pair !== "0x0000000000000000000000000000000000000000" &&
        (!/^0x[0-9a-f]{40}$/.test(token.pairToken0 ?? "") ||
          !/^0x[0-9a-f]{40}$/.test(token.pairToken1 ?? ""))
    );

    if (needsMeta.length) {
      try {
        const results = await this.publicClient.multicall({
          contracts: needsMeta.flatMap((token) => [
            {
              address: token.pair as Address,
              abi: nadFunPairAbi,
              functionName: "token0"
            },
            {
              address: token.pair as Address,
              abi: nadFunPairAbi,
              functionName: "token1"
            }
          ])
        });

        needsMeta.forEach((token, index) => {
          const token0 = results[index * 2]?.result;
          const token1 = results[index * 2 + 1]?.result;
          if (typeof token0 === "string") token.pairToken0 = token0.toLowerCase();
          if (typeof token1 === "string") token.pairToken1 = token1.toLowerCase();
        });
      } catch {}
    }

    for (const token of dexTokens) {
      this.store.upsertToken(token);
    }
  }

  private async maybeEvaluateCandidate(token: TokenSnapshot) {
    if (!this.store.get().running || this.pendingCandidates.has(token.token)) return;

    const hasOpenPosition = Object.values(this.store.get().positions).some(
      (position) => position.token === token.token && (position.status === "OPEN" || position.status === "CLOSING")
    );
    if (hasOpenPosition) return;

    if (token.lastCandidateAiAt && Date.now() - token.lastCandidateAiAt < config.aiCandidateCooldownMs) return;

    this.pendingCandidates.add(token.token);
    try {
      await this.evaluateCandidate(token);
    } finally {
      this.pendingCandidates.delete(token.token);
    }
  }

  private async evaluateCandidate(token: TokenSnapshot) {
    if (!this.store.get().running) return;

    try {
      await this.enrichToken(token);
      updateMarketMetrics(token);
      token.progressPct = curveProgressPct(token);
      token.localScore = scoreToken(token, this.seasonality);
      token.entryStrategy = selectEntryStrategy(token, config.dailyMinSamples);

      const watchable = shouldWatch(
        token,
        config.minLiquidityUsd,
        config.minMarketCapUsd,
        config.minHolders,
        config.minVolumeUsd
      );
      const lowCapMomentum = isLowCapMomentumCandidate(token, {
      enabled: config.lowCapMomentumEnabled,
      minMarketCapUsd: config.lowCapMinMarketCapUsd,
      maxMarketCapUsd: config.lowCapMaxMarketCapUsd,
      minLiquidityUsd: config.lowCapMinLiquidityUsd,
      minHolders: config.lowCapMinHolders,
      minVolumeUsd: config.lowCapMinVolumeUsd,
      minAgeMinutes: config.lowCapMinAgeMinutes,
      minBuySellRatio5m: config.lowCapMinBuySellRatio5m,
      minVolume5mUsd: config.lowCapMinVolume5mUsd,
      minVolumeAcceleration5m: config.lowCapMinVolumeAcceleration5m,
      minTrend1hPct: config.lowCapMinTrend1hPct,
      minLocalScore: config.lowCapMinScore
    });
      const candidateWatchReason = lowCapMomentum
        ? "ENTRY SETUP: low-cap momentum; awaiting AI"
        : "ENTRY SETUP: established candidate; awaiting AI";
      if (lowCapMomentum) token.watchReason = candidateWatchReason;
      if (
        (!watchable && !lowCapMomentum) ||
        (token.watchReason !== candidateWatchReason && !lowCapMomentum) ||
        (Date.now() - token.lastMarketAt! > (lowCapMomentum ? config.lowCapCandidateMaxAgeSeconds * 1000 : config.discoveryPollMs * 2))
      ) {
        return;
      }

      let decision: import("./ai.js").AiDecision;
      let usedAiFallback = false;

      try {
        decision = await this.brain.decide({
          mode: "candidate",
          token,
          seasonality: this.seasonality.summary()
        });
      } catch (error) {
        if (!config.aiFallbackEnabled || token.localScore < config.aiFallbackMinScore) {
          throw error;
        }

        // Aggressive fallback: when Gemini is unavailable/rate-limited, keep
        // trading only candidates that already passed every hard market gate.
        // This never bypasses shouldOpen(); it simply removes AI availability
        // as the single point of failure for an otherwise qualified setup.
        const dip = token.dipPct ?? 0;
        const trend1h = token.trendPct1h ?? 0;
        const trend4h = token.trendPct4h ?? 0;
        const buySell = token.buySellRatio5m ?? 0;
        const volume5mUsd = (token.volume5mMon ?? 0) * (token.monUsdPrice ?? 0);

        const pullbackSetup =
          dip >= config.dipMinPct &&
          dip <= config.dipMaxPct &&
          trend1h <= config.trendMax1hPct &&
          trend4h >= config.minTrend4hPct;

        const activeMomentumSetup =
          trend1h > 0 &&
          trend1h <= config.trendMax1hPct &&
          trend4h >= config.minTrend4hPct &&
          (buySell >= 0.85 || volume5mUsd >= config.minVolume5mUsd * 0.20);
        const lowCapSetup = isLowCapMomentumCandidate(token, {
      enabled: config.lowCapMomentumEnabled,
      minMarketCapUsd: config.lowCapMinMarketCapUsd,
      maxMarketCapUsd: config.lowCapMaxMarketCapUsd,
      minLiquidityUsd: config.lowCapMinLiquidityUsd,
      minHolders: config.lowCapMinHolders,
      minVolumeUsd: config.lowCapMinVolumeUsd,
      minAgeMinutes: config.lowCapMinAgeMinutes,
      minBuySellRatio5m: config.lowCapMinBuySellRatio5m,
      minVolume5mUsd: config.lowCapMinVolume5mUsd,
      minVolumeAcceleration5m: config.lowCapMinVolumeAcceleration5m,
      minTrend1hPct: config.lowCapMinTrend1hPct,
      minLocalScore: config.lowCapMinScore
    });

        if (!pullbackSetup && !activeMomentumSetup && !lowCapSetup) {
          throw error;
        }

        usedAiFallback = true;
        decision = {
          action: "BUY",
          confidence: Math.max(config.aiMinConfidence, 0.50),
          sizePct: 0.75,
          reason: "AI unavailable; deterministic aggressive setup passed hard market gates.",
          invalidation: "Hard entry gates fail or momentum/liquidity deteriorates."
        };

        this.store.update((s) => {
          s.stats.aiFailures += 1;
          s.stats.lastAiError = error instanceof Error ? error.message : String(error);
          s.stats.lastAiFailureAt = Date.now();
        });
      }

      token.lastCandidateAiAt = Date.now();

      // In aggressive mode, AI is advisory rather than an absolute veto.
      // A strong deterministic setup can promote AI HOLD to BUY after all
      // hard market gates have already passed.
      if (decision.action === "HOLD" && config.aiFallbackEnabled) {
        const dip = token.dipPct ?? 0;
        const trend1h = token.trendPct1h ?? 0;
        const trend4h = token.trendPct4h ?? 0;
        const buySell = token.buySellRatio5m ?? 0;
        const volume5mUsd = (token.volume5mMon ?? 0) * (token.monUsdPrice ?? 0);
        const pullbackSetup =
          dip >= config.dipMinPct &&
          dip <= config.dipMaxPct &&
          trend1h <= config.trendMax1hPct &&
          trend4h >= config.minTrend4hPct;
        const momentumSetup =
          dip <= config.dipMaxPct &&
          trend1h > 0 &&
          trend1h <= config.trendMax1hPct &&
          trend4h >= config.minTrend4hPct &&
          (buySell >= 0.85 || volume5mUsd >= config.minVolume5mUsd * 0.20);
        const lowCapSetup = isLowCapMomentumCandidate(token, {
      enabled: config.lowCapMomentumEnabled,
      minMarketCapUsd: config.lowCapMinMarketCapUsd,
      maxMarketCapUsd: config.lowCapMaxMarketCapUsd,
      minLiquidityUsd: config.lowCapMinLiquidityUsd,
      minHolders: config.lowCapMinHolders,
      minVolumeUsd: config.lowCapMinVolumeUsd,
      minAgeMinutes: config.lowCapMinAgeMinutes,
      minBuySellRatio5m: config.lowCapMinBuySellRatio5m,
      minVolume5mUsd: config.lowCapMinVolume5mUsd,
      minVolumeAcceleration5m: config.lowCapMinVolumeAcceleration5m,
      minTrend1hPct: config.lowCapMinTrend1hPct,
      minLocalScore: config.lowCapMinScore
    });

        if (token.localScore >= config.aiOverrideScore && (pullbackSetup || momentumSetup || lowCapSetup)) {
          decision = {
            ...decision,
            action: "BUY",
            confidence: Math.max(decision.confidence, config.aiMinConfidence),
            sizePct: Math.max(decision.sizePct, 0.75),
            reason: "Strong deterministic setup overrides AI HOLD; hard gates passed.",
            invalidation: "Hard entry gates fail or momentum/liquidity deteriorates."
          };
        }
      }

      const aiDiagnostics = entryGateDiagnostics(
        token,
        {
          minEstablishedAgeMinutes: config.minEstablishedAgeMinutes,
          minLiquidityUsd: config.minLiquidityUsd,
          minMarketCapUsd: config.minMarketCapUsd,
          minHolders: config.minHolders,
          minVolumeUsd: config.minVolumeUsd,
          dipMinPct: config.dipMinPct,
          dipMaxPct: config.dipMaxPct,
          recoveryMinPct: config.recoveryMinPct,
          trendMax1hPct: config.trendMax1hPct,
          minTrend4hPct: config.minTrend4hPct,
          minLocalScore: config.minLocalScore,
          minAiConfidence: config.aiMinConfidence
        },
        decision.confidence
      );
      aiDiagnostics.aiAction = decision.action;
      aiDiagnostics.aiConfidence = decision.confidence;

      // The established-token diagnostics intentionally reject pre-graduation
      // and sub-$25k assets. That is not the correct lane for low-cap momentum,
      // so present the low-cap gates instead of showing a misleading "not
      // graduated / MC < $25k" blocker in the dashboard.
      if (lowCapMomentum) {
        const lowCapBlockers = lowCapMomentumBlockers(token, {
          enabled: config.lowCapMomentumEnabled,
          minMarketCapUsd: config.lowCapMinMarketCapUsd,
          maxMarketCapUsd: config.lowCapMaxMarketCapUsd,
          minLiquidityUsd: config.lowCapMinLiquidityUsd,
          minHolders: config.lowCapMinHolders,
          minVolumeUsd: config.lowCapMinVolumeUsd,
          minAgeMinutes: config.lowCapMinAgeMinutes,
          minBuySellRatio5m: config.lowCapMinBuySellRatio5m,
          minVolume5mUsd: config.lowCapMinVolume5mUsd,
          minVolumeAcceleration5m: config.lowCapMinVolumeAcceleration5m,
          minTrend1hPct: config.lowCapMinTrend1hPct,
          minLocalScore: config.lowCapMinScore
        });
        aiDiagnostics.primary = lowCapBlockers[0] ?? "low-cap momentum setup passed";
        aiDiagnostics.blockers = lowCapBlockers;
        aiDiagnostics.readyForAi = lowCapBlockers.length === 0;
      }
      token.entryDiagnostics = aiDiagnostics;

      this.store.update((s) => {
        if (!usedAiFallback) s.stats.aiCalls += 1;
        const current = s.tokens[token.token];
        if (current) {
          current.aiAction = decision.action;
          current.aiConfidence = decision.confidence;
          current.aiReason = decision.reason;
          current.lastCandidateAiAt = token.lastCandidateAiAt;
          current.entryDiagnostics = aiDiagnostics;
        }
      });

      if (decision.action !== "BUY") {
        this.store.update((s) => {
          s.stats.lastIdleReason = token.symbol + ": AI " + decision.action + " (" + Math.round(decision.confidence * 100) + "%) — " + decision.reason;
        });
      }

      if (
        decision.action === "BUY" &&
        (lowCapMomentum
          ? decision.confidence >= config.aiMinConfidence && lowCapMomentum
          : shouldOpen(
          token,
          decision.confidence,
          config.minLocalScore,
          config.aiMinConfidence,
          config.minEstablishedAgeMinutes,
          config.minLiquidityUsd,
          config.minMarketCapUsd,
          config.minHolders,
          config.minVolumeUsd,
          config.dipMinPct,
          config.dipMaxPct,
          config.recoveryMinPct,
          config.trendMax1hPct,
          config.minTrend4hPct
        ))
      ) {
        const requestedSize = Math.max(0.05, Math.min(1, decision.sizePct));
        await this.openPosition(token, lowCapMomentum ? Math.min(requestedSize, 0.65) : requestedSize);
      }

      this.emit();
    } catch (error) {
      this.store.update((s) => {
        s.stats.aiFailures += 1;
        s.stats.lastAiError = error instanceof Error ? error.message : String(error);
        s.stats.lastAiFailureAt = Date.now();
      });
      this.emit();
    }
  }

  private async openPosition(token: TokenSnapshot, aiSizePct: number) {
    const ageMinutes = (Date.now() - token.createdAt) / 60000;
    if (this.entryCircuitBreakerActive()) return;
    const lowCapMomentum = isLowCapMomentumCandidate(token, {
      enabled: config.lowCapMomentumEnabled,
      minMarketCapUsd: config.lowCapMinMarketCapUsd,
      maxMarketCapUsd: config.lowCapMaxMarketCapUsd,
      minLiquidityUsd: config.lowCapMinLiquidityUsd,
      minHolders: config.lowCapMinHolders,
      minVolumeUsd: config.lowCapMinVolumeUsd,
      minAgeMinutes: config.lowCapMinAgeMinutes,
      minBuySellRatio5m: config.lowCapMinBuySellRatio5m,
      minVolume5mUsd: config.lowCapMinVolume5mUsd,
      minVolumeAcceleration5m: config.lowCapMinVolumeAcceleration5m,
      minTrend1hPct: config.lowCapMinTrend1hPct,
      minLocalScore: config.lowCapMinScore
    });
    if (
      config.establishedOnly &&
      !lowCapMomentum &&
      (!token.graduated ||
        ageMinutes < config.minEstablishedAgeMinutes ||
        (token.liquidityUsd ?? 0) < config.minLiquidityUsd ||
        (token.marketCapUsd ?? 0) < config.minMarketCapUsd)
    ) {
      return;
    }

    const stateBeforeBuy = this.store.get();
    const normalizedToken = token.token.toLowerCase();
    const hasOpenPosition = Object.values(stateBeforeBuy.positions).some(
      (p) => p.token.toLowerCase() === normalizedToken && (p.status === "OPEN" || p.status === "CLOSING")
    );
    const hasPendingBuy = Object.values(stateBeforeBuy.pendingExecutions).some(
      (pending) => pending.side === "BUY" && pending.token.toLowerCase() === normalizedToken
    );
    if (hasOpenPosition || hasPendingBuy) return;

    const activePositionCount = Object.values(stateBeforeBuy.positions).filter(
      (p) => p.status === "OPEN" || p.status === "CLOSING"
    ).length;
    const pendingBuyCount = Object.values(stateBeforeBuy.pendingExecutions).filter(
      (pending) => pending.side === "BUY"
    ).length;
    if (activePositionCount + pendingBuyCount >= config.maxOpenPositions) return;

    await this.refreshBalance();

    const state = this.store.get();
    const hasOpenPositionAfterRefresh = Object.values(state.positions).some(
      (p) => p.token.toLowerCase() === normalizedToken && (p.status === "OPEN" || p.status === "CLOSING")
    );
    const hasPendingBuyAfterRefresh = Object.values(state.pendingExecutions).some(
      (pending) => pending.side === "BUY" && pending.token.toLowerCase() === normalizedToken
    );
    if (hasOpenPositionAfterRefresh || hasPendingBuyAfterRefresh) return;
    const freeBalance = Math.max(0, state.balanceMon - config.gasReserveMon);
    const perTrade = freeBalance * config.positionSizePct / 100;
    const maxExposure = Math.max(0, state.balanceMon * config.maxTotalExposurePct / 100);
    const capacity = Math.max(0, maxExposure - state.openExposureMon);
    const availableCapacity = Math.max(0, capacity - this.reservedSpendMon);
    const volatilityFactor = entrySizeVolatilityFactor(token);
    const baseSpend = Math.min(perTrade, availableCapacity, freeBalance) * aiSizePct * volatilityFactor;
    // On low-cap pools, size the order against available quote liquidity so the
    // bot does not become the market. The 2% default is a risk guard, not a
    // claim about an optimal market-impact threshold.
    const lowCapLiquidityMon = lowCapMomentum && (token.liquidityMon ?? 0) > 0
      ? token.liquidityMon!
      : Number.POSITIVE_INFINITY;
    const liquidityCap = Number.isFinite(lowCapLiquidityMon)
      ? lowCapLiquidityMon * config.lowCapMaxLiquidityPositionPct / 100
      : Number.POSITIVE_INFINITY;
    const spend = Math.min(baseSpend, liquidityCap);

    if (spend <= 0.001) return;

    // Never send a token from a different DEX/route into the NadFun router.
    // NadFun's router reverts with TokenNotFound for tokens such as CHOG that
    // are traded on an external DEX instead of the NadFun market.
    this.reservedSpendMon += spend;

    const pendingId = "BUY:" + token.token.toLowerCase() + ":" + Date.now();
    this.store.update((s) => {
      s.pendingExecutions[pendingId] = {
        id: pendingId,
        side: "BUY",
        token: token.token,
        symbol: token.symbol,
        spendMon: spend,
        createdAt: Date.now()
      };
    });
    try {
      let amountRaw: bigint;
      let decimals = 18;
      let tx = "PAPER";

    if (config.liveTrading) {
      if (!this.walletClient || !this.account) throw new Error("No live wallet");

      tx = await buyNative(
        this.walletClient,
        this.publicClient,
        token.token as Address,
        spend,
        config.slippagePct
      );

      this.store.update((s) => {
        const pending = s.pendingExecutions[pendingId];
        if (pending) {
          pending.txHash = tx;
          pending.submittedAt = Date.now();
        }
      });
      await this.persist();

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === "reverted") {
        throw new Error("Buy transaction reverted: " + tx);
      }

      // Reconcile the confirmed on-chain transfer from the receipt first.
      // A post-tx RPC/balance-read failure must never erase a successful BUY.
      const transfers = parseEventLogs({
        abi: erc20Abi,
        logs: receipt.logs,
        eventName: "Transfer"
      });
      const recipient = this.account.address.toLowerCase();
      amountRaw = transfers
        .filter((log: any) =>
          String(log.address).toLowerCase() === token.token.toLowerCase() &&
          String(log.args?.to).toLowerCase() === recipient
        )
        .reduce((sum: bigint, log: any) => sum + BigInt(log.args?.value ?? 0n), 0n);

      if (amountRaw <= 0n) {
        throw new Error("Buy confirmed but token Transfer log could not be reconciled: " + tx);
      }

      if (amountRaw <= 0n) {
        throw new Error("Buy confirmed but token amount could not be reconciled: " + tx);
      }
    } else {
      const quote = await quoteBuy(this.publicClient, token.token as Address, spend);
      amountRaw = quote.amountOut;
    }

    if (config.liveTrading) {
      try { decimals = await getTokenDecimals(this.publicClient, token.token as Address); } catch {}
    }
    const tokenAmount = Number(formatUnits(amountRaw, decimals));
    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
      throw new Error("Invalid token amount received");
    }

    const id = token.token + ":" + Date.now();
    this.store.update((s) => {
      const pending = s.pendingExecutions[pendingId];
      if (pending) {
        pending.amountRaw = amountRaw.toString();
        pending.decimals = decimals;
      }
    });

    const position: Position = {
      id,
      token: token.token,
      symbol: token.symbol,
      amountRaw: amountRaw.toString(),
      decimals,
      entryMon: spend,
      entryPriceMon: spend / tokenAmount,
      currentMon: spend,
      pnlMon: 0,
      pnlPct: 0,
      realizedPnlMon: 0,
      peakMon: spend,
      peakPnlPct: 0,
      entryLiquidityUsd: token.liquidityUsd ?? 0,
      strategy: token.entryStrategy ?? "UNKNOWN",
      openedAt: Date.now(),
      lastAiAt: 0,
      entryTx: tx,
      costBasisKnown: true,
      status: "OPEN"
    };

      this.store.upsertPosition(position);
      this.store.addTrade({
      id: "BUY:" + id,
      ts: Date.now(),
      action: "BUY",
      token: token.token,
      symbol: token.symbol,
      amountMon: spend,
      txHash: tx,
      reason: "local=" + token.localScore + " ai BUY",
      score: token.localScore,
      aiConfidence: token.aiConfidence
      });
      this.emit();
    } finally {
      this.store.update((s) => {
        delete s.pendingExecutions[pendingId];
      });
      this.reservedSpendMon = Math.max(0, this.reservedSpendMon - spend);
    }
  }

  private async reconcileWalletPositions() {
    if (!this.account) return;

    const state = this.store.get();
    const tokens = Object.values(state.tokens).filter(
      (token) => /^0x[0-9a-fA-F]{40}$/.test(token.token)
    );
    let recovered = 0;

    if (tokens.length === 0) {
      this.store.update((s) => {
        s.stats.lastReconciliationAt = Date.now();
        s.stats.recoveredPositions = 0;
      });
      return;
    }

    try {
      // Batch all known balanceOf calls through Multicall3. Cloudflare counts
      // outbound RPC calls as Worker subrequests, so N individual reads can
      // exceed the per-invocation limit even when each call is cheap.
      const balances = await getTokenBalances(
        this.publicClient,
        tokens.map((token) => token.token as Address),
        this.account.address
      );

      const stateNow = this.store.get();
      for (const position of Object.values(stateNow.positions)) {
        if (position.status !== "OPEN" && position.status !== "CLOSING") continue;
        const balanceRaw = balances.get(position.token.toLowerCase()) ?? 0n;
        if (balanceRaw > 0n) continue;

        // The wallet is the source of truth for whether tokens are still held.
        // A prior successful sell can leave a stale OPEN position if the old
        // reconciliation path refused to close on a zero on-chain balance.
        position.status = "CLOSED";
        position.currentMon = 0;
        position.pnlMon = 0;
        position.pnlPct = 0;
        position.peakMon = 0;
        position.closeReason = "ONCHAIN_BALANCE_ZERO_RECONCILED";
        position.amountRaw = "0";
        this.store.upsertPosition(position);
      }

      const candidates: Array<{ token: TokenSnapshot; balanceRaw: bigint }> = [];
      const quoteRequests: Array<{ token: Address; amountRaw: bigint }> = [];

      for (const token of tokens) {
        const existing = Object.values(this.store.get().positions).find(
          (p) =>
            p.token.toLowerCase() === token.token.toLowerCase() &&
            (p.status === "OPEN" || p.status === "CLOSING")
        );
        if (existing) continue;

        const balanceRaw = balances.get(token.token.toLowerCase()) ?? 0n;
        if (balanceRaw <= 0n) continue;

        candidates.push({ token, balanceRaw });
        quoteRequests.push({ token: token.token as Address, amountRaw: balanceRaw });
      }

      const quotes = await quoteSells(this.publicClient, quoteRequests);

      for (const { token, balanceRaw } of candidates) {
        try {
          const currentQuote = quotes.get(token.token.toLowerCase());
          if (currentQuote == null) continue;

          // Decimals are only read for actual non-zero holdings, not every
          // discovered token.
          const decimals = await getTokenDecimals(
            this.publicClient,
            token.token as Address
          );
          const currentMon = Number(formatUnits(currentQuote, 18));

          if (!Number.isFinite(currentMon) || currentMon < 0.001) continue;

          const id = "RECOVERED:" + token.token.toLowerCase();
          const position: Position = {
            id,
            token: token.token,
            symbol: token.symbol,
            amountRaw: balanceRaw.toString(),
            decimals,
            entryMon: currentMon,
            entryPriceMon: currentMon / Math.max(Number(formatUnits(balanceRaw, decimals)), 1e-18),
            currentMon,
            realizedPnlMon: 0,
            pnlMon: 0,
            pnlPct: 0,
            peakMon: currentMon,
            peakPnlPct: 0,
            entryLiquidityUsd: token.liquidityUsd ?? 0,
            strategy: token.entryStrategy ?? "UNKNOWN",
            openedAt: Date.now(),
            lastAiAt: 0,
            entryTx: "RECOVERED_ONCHAIN_BALANCE",
            costBasisKnown: false,
            recoveredAt: Date.now(),
            status: "OPEN"
          };

          this.store.upsertPosition(position);
          recovered += 1;
        } catch (error) {
          this.store.update((s) => {
            s.stats.lastError = error instanceof Error ? error.message : String(error);
          });
        }
      }
    } catch (error) {
      this.store.update((s) => {
        s.stats.lastError = error instanceof Error ? error.message : String(error);
      });
    }

    this.store.update((s) => {
      s.stats.lastReconciliationAt = Date.now();
      s.stats.recoveredPositions = recovered;
    });

    if (recovered > 0) {
      await this.persist();
      this.emit();
    }
  }

  private async managePositions() {
    const positions = Object.values(this.store.get().positions).filter((p) => p.status === "OPEN");
    let unrealized = 0;
    let exposure = 0;

    const exitRules: PositionExitRules = {
      hardStopPct: config.hardStopPct,
      takeProfitPct: config.takeProfitPct,
      trailingPct: config.trailingPct,
      maxHoldMinutes: config.maxHoldMinutes,
      staleLossExitMinutes: config.staleLossExitMinutes,
      staleLossExitPct: config.staleLossExitPct,
      deadMoneyExitMinutes: config.deadMoneyExitMinutes,
      deadMoneyMaxPnlPct: config.deadMoneyMaxPnlPct,
      dustPositionMon: config.dustPositionMon,
      dailyMeanExitPct: config.dailyMeanExitPct,
      dailyMinSamples: config.dailyMinSamples,
      minLiquidityUsd: config.minLiquidityUsd,
      liquidityExitRatio: config.liquidityExitRatio,
      earlyExitLossPct: config.earlyExitLossPct,
      earlyExitTrend1hPct: config.earlyExitTrend1hPct,
      momentumExitProfitPct: config.momentumExitProfitPct,
      momentumExitTrend1hPct: config.momentumExitTrend1hPct,
      momentumExitReboundPct: config.momentumExitReboundPct,
      sellPressureExitRatio: config.sellPressureExitRatio,
      sellPressureMinVolumeUsd: config.sellPressureMinVolumeUsd,
      profitTake1Pct: config.profitTake1Pct,
      profitTake1SellPct: config.profitTake1SellPct,
      profitTake2Pct: config.profitTake2Pct,
      profitTake2SellPct: config.profitTake2SellPct,
      profitTake3Pct: config.profitTake3Pct,
      profitTake3SellPct: config.profitTake3SellPct,
      profitProtectionStartPct: config.profitProtectionStartPct,
      profitProtectionFloorPct: config.profitProtectionFloorPct,
      profitProtectionRatio: config.profitProtectionRatio
      ,lowCapMaxMarketCapUsd: config.lowCapMaxMarketCapUsd,
      lowCapLiquidityExitRatio: config.lowCapLiquidityExitRatio,
      lowCapSellPressureRatio: config.lowCapSellPressureRatio,
      lowCapSellPressureMinVolumeUsd: config.lowCapSellPressureMinVolumeUsd,
      lowCapTrendExitPct: config.lowCapTrendExitPct,
      lowCapLossExitPct: config.lowCapLossExitPct,
      lowCapPeakDrawdownExitPct: config.lowCapPeakDrawdownExitPct
    };

    for (const position of positions) {
      try {
        const token = this.store.get().tokens[position.token];
        if (token) {
          await this.enrichToken(token);
          updateMarketMetrics(token);
          token.localScore = scoreToken(token, this.seasonality);
          token.entryStrategy = selectEntryStrategy(token, config.dailyMinSamples);
          this.store.upsertToken(token);
        }

        let amountRaw = BigInt(position.amountRaw);

        if (config.liveTrading) {
          const balance = await getTokenBalance(
            this.publicClient,
            position.token as Address,
            this.account.address
          );
          if (balance === 0n) continue;
          if (balance < amountRaw) {
            amountRaw = balance;
            position.amountRaw = balance.toString();
          }
        }

        const out = await quoteSell(this.publicClient, position.token as Address, amountRaw);
        position.currentMon = Number(formatUnits(out, 18));
        position.pnlMon = position.currentMon - position.entryMon;
        position.pnlPct = position.entryMon ? position.pnlMon / position.entryMon * 100 : 0;
        position.peakMon = Math.max(position.peakMon, position.currentMon);
        position.peakPnlPct = Math.max(position.peakPnlPct ?? position.pnlPct, position.pnlPct);

        const signal = positionExitSignal(position, token, exitRules);
        if (signal) {
          if (signal.kind === "PARTIAL") {
            await this.sellPosition(position, signal.sellPct, signal.reason);
          } else {
            await this.sellPosition(position, 100, signal.reason);
          }
          if (position.status !== "OPEN") continue;
        } else {
          const exit = shouldClose(
            position,
            config.hardStopPct,
            config.takeProfitPct,
            config.trailingPct,
            config.maxHoldMinutes
          );
          if (exit) await this.sellPosition(position, 100, exit);
          if (position.status !== "OPEN") continue;
        }

        unrealized += position.pnlMon;
        exposure += position.currentMon;
      } catch (error) {
        this.store.update((s) => {
          s.stats.lastError = error instanceof Error ? error.message : String(error);
        });
      }
    }

    this.store.update((s) => {
      s.unrealizedPnlMon = unrealized;
      s.openExposureMon = exposure;
    });

    await this.refreshBalance();
    this.emit();
  }

  private async reviewOpenPositions() {
    for (const position of Object.values(this.store.get().positions).filter((p) => p.status === "OPEN")) {
      if (!this.store.get().running) return;

      const token = this.store.get().tokens[position.token];
      if (!token) continue;

      try {
        const decision = await this.brain.decide({
          mode: "position",
          token,
          position,
          seasonality: this.seasonality.summary()
        });

        position.lastAiAt = Date.now();
        position.lastAiAction = decision.action;
        position.lastAiConfidence = decision.confidence;
        position.lastAiReason = decision.reason;

        this.store.update((s) => {
          s.stats.aiCalls += 1;
        });

        if (decision.action === "SELL" && decision.confidence >= config.aiMinConfidence) {
          const aiSellPct =
            position.pnlPct <= config.staleLossExitPct || decision.confidence >= 0.80
              ? 100
              : Math.max(25, Math.min(100, decision.sizePct * 100));
          await this.sellPosition(
            position,
            aiSellPct,
            "AI_SELL:" + decision.reason
          );
        }
      } catch (error) {
        this.store.update((s) => {
          s.stats.aiFailures += 1;
          s.stats.lastAiError = error instanceof Error ? error.message : String(error);
          s.stats.lastAiFailureAt = Date.now();
        });
      }
    }

    this.emit();
  }

  private async sellPosition(position: Position, sellPct: number, reason: string) {
    if (position.status !== "OPEN") return;

    position.status = "CLOSING";
    this.emit();

    const fractionPct = Math.max(1, Math.min(100, sellPct));

    try {
      let tx = "PAPER";
      let proceeds = 0;
      const priorAmountRaw = BigInt(position.amountRaw);
      if (priorAmountRaw <= 0n) throw new Error("No token balance recorded for sell");

      let walletTokenBalance = priorAmountRaw;
      if (config.liveTrading) {
        if (!this.walletClient || !this.account) throw new Error("No live wallet");
        walletTokenBalance = await getTokenBalance(
          this.publicClient,
          position.token as Address,
          this.account.address
        );
        if (walletTokenBalance === 0n) {
          throw new Error("Token balance is zero; refusing to mark an unsold position closed");
        }
      }

      const maxSellRaw = walletTokenBalance < priorAmountRaw ? walletTokenBalance : priorAmountRaw;
      const targetBps = BigInt(Math.round(fractionPct * 100));
      let soldAmountRaw = maxSellRaw * targetBps / 10000n;
      if (fractionPct >= 100) soldAmountRaw = maxSellRaw;
      if (soldAmountRaw <= 0n) throw new Error("Calculated sell amount is zero");

      const soldFraction = Number(soldAmountRaw) / Math.max(1, Number(priorAmountRaw));
      const safeSoldFraction = Math.max(0, Math.min(1, soldFraction));
      const costBasisSold = position.entryMon * safeSoldFraction;

      if (config.liveTrading) {
        const nativeBefore = BigInt(String(
          await this.publicClient.getBalance({ address: this.account.address })
        ));

        tx = await sellToNative(
          this.walletClient,
          this.publicClient,
          position.token as Address,
          soldAmountRaw,
          config.slippagePct
        );

        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: tx });
        if (receipt.status === "reverted") {
          throw new Error("Sell transaction reverted: " + tx);
        }
        const nativeAfter = await this.readNativeBalanceWithRetry();
        const gasUsed = BigInt(String(receipt.gasUsed ?? 0));
        const effectiveGasPrice = BigInt(String(receipt.effectiveGasPrice ?? 0));
        const gasCost = gasUsed * effectiveGasPrice;
        const netProceedsRaw = nativeAfter + gasCost - nativeBefore;
        proceeds = Number(formatUnits(netProceedsRaw > 0n ? netProceedsRaw : 0n, 18));
      } else {
        const quote = await quoteSell(this.publicClient, position.token as Address, soldAmountRaw);
        proceeds = Number(formatUnits(quote, 18));
      }

      if (!Number.isFinite(proceeds) || proceeds < 0) {
        throw new Error("Invalid sell proceeds");
      }

      // The confirmed swap consumed exactly soldAmountRaw. Do not make
      // successful SELL reconciliation depend on a second token-balance RPC
      // call: if that RPC fails after the swap, the old code could leave a
      // phantom OPEN position even though the tokens were already sold.
      const remainingAmountRaw = walletTokenBalance - soldAmountRaw;

      const realizedPnl = proceeds - costBasisSold;
      const remainingCostBasis = Math.max(0, position.entryMon - costBasisSold);
      const totalRealizedPnl = (position.realizedPnlMon ?? 0) + realizedPnl;

      this.store.addTrade({
        id: "SELL:" + position.id + ":" + Date.now(),
        ts: Date.now(),
        action: "SELL",
        token: position.token,
        symbol: position.symbol,
        amountMon: proceeds,
        pnlMon: realizedPnl,
        pnlPct: costBasisSold ? realizedPnl / costBasisSold * 100 : 0,
        txHash: tx,
        reason,
        aiConfidence: position.lastAiConfidence
      });

      this.store.update((s) => {
        s.realizedPnlMon += realizedPnl;
      });

      position.realizedPnlMon = totalRealizedPnl;
      position.amountRaw = remainingAmountRaw.toString();
      position.entryMon = remainingCostBasis;

      if (remainingAmountRaw === 0n || safeSoldFraction >= 0.999999) {
        position.currentMon = 0;
        position.pnlMon = 0;
        position.pnlPct = 0;
        position.peakMon = 0;
        position.status = "CLOSED";
        position.closeTx = tx;
        position.closeReason = reason;
        position.amountRaw = "0";
        if (totalRealizedPnl >= 0) this.store.update((s) => { s.stats.wins += 1; });
        else this.store.update((s) => { s.stats.losses += 1; });
      } else {
        const remainingValue = await quoteSell(
          this.publicClient,
          position.token as Address,
          remainingAmountRaw
        );
        position.currentMon = Number(formatUnits(remainingValue, 18));
        position.pnlMon = position.currentMon - position.entryMon;
        position.pnlPct = position.entryMon ? position.pnlMon / position.entryMon * 100 : 0;
        position.peakMon = Math.max(0, position.peakMon * (1 - safeSoldFraction));
        position.peakPnlPct = Math.max(position.peakPnlPct ?? position.pnlPct, position.pnlPct);

        if (reason === "PROFIT_TAKE_1") position.profitTake1Done = true;
        if (reason === "PROFIT_TAKE_2") position.profitTake2Done = true;
        if (reason === "PROFIT_TAKE_3") position.profitTake3Done = true;

        position.status = "OPEN";
        this.store.upsertPosition(position);
      }
    } catch (error) {
      position.status = "OPEN";
      position.closeReason = error instanceof Error ? error.message : String(error);
      this.store.update((s) => {
        s.stats.lastError = position.closeReason;
      });
    }

    if (position.status === "CLOSED") {
      this.store.upsertPosition(position);
    }
    this.emit();
  }

  private async closePosition(position: Position, reason: string) {
    await this.sellPosition(position, 100, reason);
  }

  private async readNativeBalanceWithRetry() {
    if (!this.account) throw new Error("No live wallet");
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return BigInt(String(await this.publicClient.getBalance({ address: this.account.address })));
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async refreshBalance() {
    if (!this.account) return;

    try {
      const balance = await getBalance(this.publicClient, this.account.address);
      const state = this.store.get();
      const openPositions = Object.values(state.positions).filter((p) => p.status === "OPEN");
      const openExposureMon = openPositions.reduce((sum, p) => sum + Math.max(0, p.currentMon), 0);
      const unrealizedPnlMon = openPositions.reduce((sum, p) => sum + p.pnlMon, 0);
      const equityMon = balance + openExposureMon;

      this.store.update((s) => {
        s.balanceMon = balance;
        s.openExposureMon = openExposureMon;
        s.unrealizedPnlMon = unrealizedPnlMon;
      });
      this.store.addEquity({
        ts: Date.now(),
        balanceMon: balance,
        openExposureMon,
        unrealizedPnlMon,
        equityMon,
        realizedPnlMon: this.store.get().realizedPnlMon
      });
    } catch (error) {
      this.store.update((s) => {
        s.stats.lastError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private async persist() {
    try {
      await this.store.save();
    } catch (error) {
      this.store.update((s) => {
        s.stats.lastError = error instanceof Error ? error.message : String(error);
      });
    }
  }
}