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
  getTokenDecimals,
  quoteBuy,
  quoteSell,
  buyNative,
  sellToNative
} from "./nadfun.js";
import { StateStore } from "./store.js";
import { GeminiBrain } from "./ai.js";
import { SeasonalityModel, positionExitSignal, scoreToken, shouldClose, shouldOpen, shouldWatch, updateMarketMetrics, curveProgressPct, type PositionExitRules } from "./strategy.js";
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
    price_usd?: string;
    token_price?: string;
    reserve_native?: string;
    reserve_token?: string;
    volume?: string;
    ath_price?: string;
    market_type?: string;
    is_locked?: boolean;
  };
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

  async init() {
    await this.store.load();
    this.store.update((s) => {
      s.walletAddress = this.account?.address ?? "";
      s.liveTrading = config.liveTrading;
    });
    this.seasonality.hydrate(this.store.get().seasonality);

    if (this.account) await this.refreshBalance();
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
      const url =
        config.nadfunApiUrl +
        "/order/market_cap?page=1&limit=" +
        config.discoveryLimit +
        "&is_nsfw=false";

      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(config.nadfunApiKey ? { "X-API-Key": config.nadfunApiKey } : {})
        }
      });

      if (!response.ok) {
        throw new Error("NadFun discovery failed: HTTP " + response.status);
      }

      const payload = decodeNadfunPayload(await response.text());
      const rows = Array.isArray(payload?.tokens) ? payload.tokens : [];

      let watched = 0;
      let eligible = 0;
      const candidates: TokenSnapshot[] = [];

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
        const holders = Math.max(0, Math.floor(numeric(market.holder_count ?? market.holders)));
        const graduated = boolish(info.is_graduated, market.market_type === "DEX");

        const existing = this.store.get().tokens[tokenAddress];

        const token: TokenSnapshot = existing ?? {
          token: tokenAddress,
          symbol: String(info.symbol ?? "?"),
          name: String(info.name ?? info.symbol ?? "Unknown"),
          creator: String(info.creator?.account_id ?? info.creator ?? ""),
          pair: String(info.pair ?? market.pair ?? ""),
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
        token.holders = holders || token.holders || 0;
        token.changePct = numeric(row?.percent ?? market.percent ?? token.changePct);
        token.priceMon = priceMon || marketPriceMon || token.priceMon || 0;
        token.priceUsd = numeric(market.price_usd ?? token.priceUsd);
        token.athPriceMon = numeric(market.ath_price ?? token.athPriceMon);
        token.lastMarketAt = Date.now();

        if (token.priceMon > 0) {
          const history = token.priceHistory ?? [];
          const previous = history.at(-1);
          if (!previous || Date.now() - previous.ts >= config.priceSampleMs) {
            history.push({ ts: Date.now(), priceMon: token.priceMon });
            token.priceHistory = history.slice(-72);
            if (previous && previous.priceMon > 0) {
              const sampleReturn = (token.priceMon / previous.priceMon - 1) * 100;
              this.seasonality.observeReturn(Date.now(), sampleReturn);
            }
          }
        }

        updateMarketMetrics(token);
        token.localScore = scoreToken(token, this.seasonality);

        const watchable = shouldWatch(
          token,
          config.minLiquidityUsd,
          config.minHolders,
          config.minVolumeMon
        );

        const age = (Date.now() - token.createdAt) / 60000;
        const isDip = (token.dipPct ?? 0) >= config.dipMinPct && (token.dipPct ?? 0) <= config.dipMaxPct;
        const hasRecovery = (token.trendPct1h ?? 0) > -8 && (token.dipPct ?? 0) <= config.dipMaxPct;

        if (!watchable) {
          token.watchReason = "Watching: below $100k MON-side liquidity / holder / volume floor";
        } else if (age < config.minEstablishedAgeMinutes) {
          token.watchReason = "Watching: too new; launch buys are disabled";
        } else if (!isDip) {
          token.watchReason = "Watching: no qualifying pullback";
        } else if (!hasRecovery) {
          token.watchReason = "Watching: falling without stabilization";
        } else if (token.localScore < config.minLocalScore) {
          token.watchReason = "Watching: quality score below entry floor";
        } else {
          token.watchReason = "ENTRY SETUP: established dip candidate; awaiting AI";
          eligible += 1;
        }

        if (watchable) watched += 1;

        this.store.upsertToken(token);

        const entrySetup = token.watchReason === "ENTRY SETUP: established dip candidate; awaiting AI";
        if (entrySetup) candidates.push(token);
      }

      candidates
        .sort((a, b) =>
          (b.localScore - a.localScore) ||
          ((b.liquidityMon ?? 0) - (a.liquidityMon ?? 0)) ||
          ((b.volumeMon ?? 0) - (a.volumeMon ?? 0))
        )
        .slice(0, config.aiCandidateLimit)
        .forEach((token) => {
          void this.maybeEvaluateCandidate(token);
        });

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

    await this.discoverEstablishedTokens();
    await this.pollLogs();
    await this.managePositions();
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

      for (let chunk = 0; chunk < config.maxLogChunksPerCycle && cursor <= latest; chunk += 1) {
        const to = latest > cursor + BigInt(config.logChunkBlocks - 1)
          ? cursor + BigInt(config.logChunkBlocks - 1)
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
        (Date.now() - token.createdAt) / 1000 <= config.candidateMaxAgeSeconds
      ) {
        void this.maybeEvaluateCandidate(token);
      }
    } catch (error) {
      this.store.update((s) => {
        s.stats.lastError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  private async enrichToken(token: TokenSnapshot) {
    const lastEnrichedAt = token.lastEnrichedAt ?? 0;
    if (Date.now() - lastEnrichedAt < 4000) return;

    token.lastEnrichedAt = Date.now();

    try {
      const endpoints = [
        config.nadfunApiUrl + "/agent/market/" + token.token,
        config.nadfunApiUrl + "/token/metadata/" + token.token
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
      token.priceUsd = Number(payload.market_info?.price_usd ?? token.priceUsd);
      token.priceMon = Number(payload.market_info?.price_native ?? token.priceMon);
      token.peakPriceMon = Math.max(token.peakPriceMon, token.priceMon);
      token.volumeUsd = Number(payload.market_info?.volume ?? token.volumeUsd);
      const reserveNative = numeric(payload.market_info?.reserve_native);
      const reserveToken = numeric(payload.market_info?.reserve_token);
      if (reserveNative > 0) token.liquidityMon = reserveNative / 1e18;
      if (reserveToken > 0 && reserveNative > 0) token.priceMon = reserveNative / reserveToken;

      const impliedMonUsd =
        token.priceMon > 0 && token.priceUsd > 0
          ? token.priceUsd / token.priceMon
          : 0;
      if (impliedMonUsd > 0) token.monUsdPrice = impliedMonUsd;
      if ((token.liquidityMon ?? 0) > 0 && (token.monUsdPrice ?? 0) > 0) {
        token.liquidityUsd = token.liquidityMon! * token.monUsdPrice!;
      }
      token.volumeMon = Number.isFinite(Number(payload.market_info?.volume))
        ? Number(payload.market_info?.volume) / 1e18
        : token.volumeMon;
      token.graduated = payload.token_info?.is_graduated ?? token.graduated;
      token.symbol = payload.token_info?.symbol ?? token.symbol;
      token.name = payload.token_info?.name ?? token.name;
      token.creator = payload.token_info?.creator?.account_id ?? token.creator;
    } catch {
      // On-chain signals remain authoritative when optional API enrichment fails.
    }
  }

  private async maybeEvaluateCandidate(token: TokenSnapshot) {
    if (!this.store.get().running || this.pendingCandidates.has(token.token)) return;

    const hasOpenPosition = Object.values(this.store.get().positions).some(
      (position) => position.token === token.token && (position.status === "OPEN" || position.status === "CLOSING")
    );
    if (hasOpenPosition) return;

    if (token.lastCandidateAiAt && Date.now() - token.lastCandidateAiAt < 30000) return;

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

      const watchable = shouldWatch(
        token,
        config.minLiquidityUsd,
        config.minHolders,
        config.minVolumeMon
      );
      if (
        !watchable ||
        token.watchReason !== "ENTRY SETUP: established dip candidate; awaiting AI" ||
        (Date.now() - token.lastMarketAt! > config.discoveryPollMs * 2)
      ) {
        return;
      }

      const decision = await this.brain.decide({
        mode: "candidate",
        token,
        seasonality: this.seasonality.summary()
      });

      token.lastCandidateAiAt = Date.now();

      this.store.update((s) => {
        s.stats.aiCalls += 1;
        const current = s.tokens[token.token];
        if (current) {
          current.aiAction = decision.action;
          current.aiConfidence = decision.confidence;
          current.aiReason = decision.reason;
          current.lastCandidateAiAt = token.lastCandidateAiAt;
        }
      });

      if (
        decision.action === "BUY" &&
        shouldOpen(
          token,
          decision.confidence,
          config.minLocalScore,
          config.aiMinConfidence,
          config.minEstablishedAgeMinutes,
          config.minLiquidityUsd,
          config.minHolders,
          config.minVolumeMon,
          config.dipMinPct,
          config.dipMaxPct,
          config.recoveryMinPct,
          config.trendMax1hPct,
          config.minTrend4hPct
        )
      ) {
        await this.openPosition(token, Math.max(0.05, Math.min(1, decision.sizePct)));
      }

      this.emit();
    } catch (error) {
      this.store.update((s) => {
        s.stats.aiFailures += 1;
        s.stats.lastError = error instanceof Error ? error.message : String(error);
      });
      this.emit();
    }
  }

  private async openPosition(token: TokenSnapshot, aiSizePct: number) {
    const ageMinutes = (Date.now() - token.createdAt) / 60000;
    if (
      config.establishedOnly &&
      (!token.graduated ||
        ageMinutes < config.minEstablishedAgeMinutes ||
        (token.liquidityUsd ?? 0) < config.minLiquidityUsd)
    ) {
      return;
    }

    const openCount = Object.values(this.store.get().positions).filter((p) => p.status === "OPEN").length;
    if (openCount >= config.maxOpenPositions) return;

    await this.refreshBalance();

    const state = this.store.get();
    const freeBalance = Math.max(0, state.balanceMon - config.gasReserveMon);
    const perTrade = freeBalance * config.positionSizePct / 100;
    const maxExposure = Math.max(0, state.balanceMon * config.maxTotalExposurePct / 100);
    const capacity = Math.max(0, maxExposure - state.openExposureMon);
    const availableCapacity = Math.max(0, capacity - this.reservedSpendMon);
    const spend = Math.min(perTrade, availableCapacity, freeBalance) * aiSizePct;

    if (spend <= 0.001) return;

    this.reservedSpendMon += spend;

    try {
      let amountRaw: bigint;
      let decimals = 18;
      let tx = "PAPER";

    if (config.liveTrading) {
      if (!this.walletClient || !this.account) throw new Error("No live wallet");

      decimals = await getTokenDecimals(this.publicClient, token.token as Address);
      const before = await getTokenBalance(this.publicClient, token.token as Address, this.account.address);

      tx = await buyNative(
        this.walletClient,
        this.publicClient,
        token.token as Address,
        spend,
        config.slippagePct
      );
      await this.publicClient.waitForTransactionReceipt({ hash: tx });

      const after = await getTokenBalance(this.publicClient, token.token as Address, this.account.address);
      amountRaw = after - before;

      if (amountRaw <= 0n) {
        throw new Error("Buy transaction confirmed but token balance did not increase");
      }
    } else {
      const quote = await quoteBuy(this.publicClient, token.token as Address, spend);
      amountRaw = quote.amountOut;
    }

    const tokenAmount = Number(formatUnits(amountRaw, decimals));
    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
      throw new Error("Invalid token amount received");
    }

    const id = token.token + ":" + Date.now();
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
      peakMon: spend,
      peakPnlPct: 0,
      entryLiquidityUsd: token.liquidityUsd ?? 0,
      openedAt: Date.now(),
      lastAiAt: 0,
      entryTx: tx,
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
      this.reservedSpendMon = Math.max(0, this.reservedSpendMon - spend);
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
      minLiquidityUsd: config.minLiquidityUsd,
      liquidityExitRatio: config.liquidityExitRatio,
      earlyExitLossPct: config.earlyExitLossPct,
      earlyExitTrend1hPct: config.earlyExitTrend1hPct,
      momentumExitProfitPct: config.momentumExitProfitPct,
      momentumExitTrend1hPct: config.momentumExitTrend1hPct,
      momentumExitReboundPct: config.momentumExitReboundPct,
      sellPressureExitRatio: config.sellPressureExitRatio,
      sellPressureMinVolumeMon: config.sellPressureMinVolumeMon,
      profitTake1Pct: config.profitTake1Pct,
      profitTake1SellPct: config.profitTake1SellPct,
      profitTake2Pct: config.profitTake2Pct,
      profitTake2SellPct: config.profitTake2SellPct,
      profitTake3Pct: config.profitTake3Pct,
      profitTake3SellPct: config.profitTake3SellPct,
      profitProtectionStartPct: config.profitProtectionStartPct,
      profitProtectionFloorPct: config.profitProtectionFloorPct,
      profitProtectionRatio: config.profitProtectionRatio
    };

    for (const position of positions) {
      try {
        const token = this.store.get().tokens[position.token];
        if (token) {
          await this.enrichToken(token);
          updateMarketMetrics(token);
          token.localScore = scoreToken(token, this.seasonality);
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
        position.currentMon = Number(formatUnits(out, position.decimals));
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
          await this.closePosition(position, "AI_SELL:" + decision.reason);
        }
      } catch (error) {
        this.store.update((s) => {
          s.stats.aiFailures += 1;
          s.stats.lastError = error instanceof Error ? error.message : String(error);
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
        const nativeAfter = BigInt(String(
          await this.publicClient.getBalance({ address: this.account.address })
        ));
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

      let remainingAmountRaw = 0n;
      if (config.liveTrading) {
        remainingAmountRaw = await getTokenBalance(
          this.publicClient,
          position.token as Address,
          this.account.address
        );
      } else {
        remainingAmountRaw = walletTokenBalance - soldAmountRaw;
      }

      const realizedPnl = proceeds - costBasisSold;
      const remainingCostBasis = Math.max(0, position.entryMon - costBasisSold);

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
        if (realizedPnl >= 0) this.store.update((s) => { s.stats.wins += 1; });
        else this.store.update((s) => { s.stats.losses += 1; });
      } else {
        const remainingValue = await quoteSell(
          this.publicClient,
          position.token as Address,
          remainingAmountRaw
        );
        position.currentMon = Number(formatUnits(remainingValue, position.decimals));
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
      position.status = "FAILED";
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

  private async refreshBalance() {
    if (!this.account) return;

    try {
      const balance = await getBalance(this.publicClient, this.account.address);
      this.store.update((s) => {
        s.balanceMon = balance;
      });
      this.store.addEquity({
        ts: Date.now(),
        balanceMon: balance,
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
