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
import { SeasonalityModel, scoreToken, shouldClose, shouldOpen, curveProgressPct } from "./strategy.js";
import type { BotState, Position, TokenSnapshot } from "./types.js";
import { formatUnits } from "viem";

type Listener = (state: BotState) => void;

interface MarketResponse {
  market_info?: {
    holder_count?: number;
    price_native?: string;
    price_usd?: string;
    volume?: string;
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
    if (this.lastBlock === 0n && persistedBlock) {
      this.lastBlock = BigInt(persistedBlock);
    }

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
        s.stats.eventCount = s.stats.eventCount;
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
        this.seasonality.observe(now, amount, 0);
      } else if (parsed.eventName === "Sell") {
        const amount = Number(formatUnits(args.quoteOut as bigint, 18));
        token.sells += 1;
        token.sellMon += amount;
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
      const response = await fetch(config.nadfunApiUrl + "/token/metadata/" + token.token, {
        headers: config.nadfunApiKey ? { "X-API-Key": config.nadfunApiKey } : {}
      });

      if (!response.ok) return;

      const payload = await response.json() as MarketResponse;
      token.holders = payload.market_info?.holder_count ?? token.holders;
      token.priceUsd = Number(payload.market_info?.price_usd ?? token.priceUsd);
      token.priceMon = Number(payload.market_info?.price_native ?? token.priceMon);
      token.peakPriceMon = Math.max(token.peakPriceMon, token.priceMon);
      token.volumeUsd = Number(payload.market_info?.volume ?? token.volumeUsd);
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
      token.progressPct = curveProgressPct(token);
      token.localScore = scoreToken(token, this.seasonality);

      if (
        token.graduated ||
        token.locked ||
        token.localScore < config.minLocalScore ||
        (Date.now() - token.createdAt) / 1000 > config.candidateMaxAgeSeconds
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
          config.candidateMaxAgeSeconds,
          config.aiMinConfidence
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

    for (const position of positions) {
      try {
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

        unrealized += position.pnlMon;
        exposure += position.currentMon;

        const exit = shouldClose(
          position,
          config.hardStopPct,
          config.takeProfitPct,
          config.trailingPct,
          config.maxHoldMinutes
        );

        if (exit) await this.closePosition(position, exit);
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

  private async closePosition(position: Position, reason: string) {
    if (position.status !== "OPEN") return;

    position.status = "CLOSING";
    this.emit();

    try {
      let tx = "PAPER";
      let proceeds = position.currentMon;
      let soldAmountRaw = BigInt(position.amountRaw);

      if (config.liveTrading) {
        if (!this.walletClient || !this.account) throw new Error("No live wallet");

        const walletTokenBalance = await getTokenBalance(
          this.publicClient,
          position.token as Address,
          this.account.address
        );

        if (walletTokenBalance === 0n) {
          throw new Error("Token balance is zero; refusing to mark an unsold position closed");
        }

        soldAmountRaw = walletTokenBalance < soldAmountRaw ? walletTokenBalance : soldAmountRaw;

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
      }

      const pnl = proceeds - position.entryMon;
      const pnlPct = position.entryMon ? pnl / position.entryMon * 100 : 0;

      position.amountRaw = "0";
      position.currentMon = proceeds;
      position.pnlMon = pnl;
      position.pnlPct = pnlPct;
      position.closeTx = tx;
      position.closeReason = reason;
      position.status = "CLOSED";

      this.store.update((s) => {
        s.realizedPnlMon += pnl;
        if (pnl >= 0) s.stats.wins += 1;
        else s.stats.losses += 1;
      });

      this.store.addTrade({
        id: "SELL:" + position.id,
        ts: Date.now(),
        action: "SELL",
        token: position.token,
        symbol: position.symbol,
        amountMon: proceeds,
        pnlMon: pnl,
        pnlPct,
        txHash: tx,
        reason,
        aiConfidence: position.lastAiConfidence
      });
    } catch (error) {
      position.status = "FAILED";
      position.closeReason = error instanceof Error ? error.message : String(error);
      this.store.update((s) => {
        s.stats.lastError = position.closeReason;
      });
    }

    this.emit();
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
