import { parseEventLogs, type Address } from "viem";
import { config, assertLiveConfig } from "./config.js";
import { clients, streamClient, ADDRESSES, curveAbi, erc20Abi, getBalance, quoteBuy, quoteSell, buyNative, sellToNative } from "./nadfun.js";
import { StateStore } from "./store.js";
import { GeminiBrain } from "./ai.js";
import { SeasonalityModel, scoreToken, shouldClose, shouldOpen } from "./strategy.js";
import type { BotState, Position, TokenSnapshot } from "./types.js";

type Listener = (state: BotState) => void;

interface MarketResponse {
  market_info?: { holder_count?: number; price_native?: string; price_usd?: string; volume?: string };
  token_info?: { name?: string; symbol?: string; is_graduated?: boolean; creator?: { account_id?: string } };
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

  constructor() {
    const c = clients();
    this.publicClient = c.publicClient;
    this.walletClient = c.walletClient;
    this.account = c.account;
  }

  onUpdate(listener: Listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot() { return this.store.get(); }
  private emit() { for (const l of this.listeners) l(this.store.get()); }

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
    this.store.update((s) => { s.running = true; s.stats.startedAt ??= Date.now(); });
    this.emit();

    await this.startEventSource();
    this.positionTimer = setInterval(() => void this.managePositions(), config.positionLoopMs);
    this.aiTimer = setInterval(() => void this.reviewOpenPositions(), config.aiPositionReviewMs);
    this.saveTimer = setInterval(() => void this.persist(), 10000);
    await this.persist();
  }

  async stop() {
    this.store.update((s) => { s.running = false; });
    if (this.unwatch) { this.unwatch(); this.unwatch = null; }
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.positionTimer) clearInterval(this.positionTimer);
    if (this.aiTimer) clearInterval(this.aiTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    await this.persist();
    this.emit();
  }

  async sellAll() {
    for (const p of Object.values(this.store.get().positions).filter((x) => x.status === "OPEN")) await this.closePosition(p, "MANUAL_SELL_ALL");
  }

  private async startEventSource() {
    const ws = streamClient();
    if (ws) {
      this.unwatch = ws.watchContractEvent({
        address: ADDRESSES.CURVE,
        abi: curveAbi,
        onLogs: (logs: any[]) => logs.forEach((log) => void this.handleLog(log))
      });
    } else {
      this.lastBlock = await this.publicClient.getBlockNumber();
      this.pollTimer = setInterval(() => void this.pollLogs(), config.eventPollMs);
    }
  }

  private async pollLogs() {
    try {
      const latest = await this.publicClient.getBlockNumber();
      if (latest <= this.lastBlock) return;
      const from = this.lastBlock + 1n;
      const to = latest > from + 20n ? from + 20n : latest;
      const logs = await this.publicClient.getLogs({ address: ADDRESSES.CURVE, fromBlock: from, toBlock: to });
      for (const log of logs) await this.handleLog(log);
      this.lastBlock = to;
    } catch (error) {
      this.store.update((s) => { s.stats.lastError = error instanceof Error ? error.message : String(error); });
    }
  }

  private async handleLog(log: any) {
    this.store.update((s) => { s.stats.eventCount += 1; });
    try {
      const parsed: any = parseEventLogs({ abi: curveAbi, logs: [log] })[0];
      if (!parsed) return;
      const args = parsed.args as any;
      const tokenAddress = String(args.token).toLowerCase();
      const now = Date.now();

      if (parsed.eventName === "Create") {
        const token: TokenSnapshot = {
          token: tokenAddress,
          symbol: String(args.symbol ?? "?"),
          name: String(args.name ?? args.symbol ?? "Unknown"),
          creator: String(args.creator),
          pair: String(args.pair),
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
          localScore: 0
        };
        await this.enrichToken(token);
        token.localScore = scoreToken(token, this.seasonality);
        this.store.upsertToken(token);
        this.emit();
        if (token.localScore >= config.minLocalScore) void this.evaluateCandidate(token);
        return;
      }

      const token = this.store.get().tokens[tokenAddress];
      if (!token) return;
      token.lastEventAt = now;

      if (parsed.eventName === "Buy") {
        const amount = Number(args.quoteIn as bigint) / 1e18;
        token.buys += 1;
        token.buyMon += amount;
        this.seasonality.observe(now, amount, 0);
      } else if (parsed.eventName === "Sell") {
        const amount = Number(args.quoteOut as bigint) / 1e18;
        token.sells += 1;
        token.sellMon += amount;
        this.seasonality.observe(now, 0, amount);
      } else if (parsed.eventName === "Graduate") {
        token.graduated = true;
      } else if (parsed.eventName === "Sync") {
        const reserve = Number(args.realQuoteReserve as bigint) / 1e18;
        token.progressPct = Math.max(0, Math.min(100, reserve / 1000));
      }

      token.localScore = scoreToken(token, this.seasonality);
      this.store.upsertToken(token);
      this.store.update((s) => { s.seasonality = this.seasonality.export(); });
      this.emit();
    } catch (error) {
      this.store.update((s) => { s.stats.lastError = error instanceof Error ? error.message : String(error); });
    }
  }

  private async enrichToken(token: TokenSnapshot) {
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
    } catch {}
  }

  private async evaluateCandidate(token: TokenSnapshot) {
    if (!this.store.get().running) return;
    try {
      const decision = await this.brain.decide({ mode: "candidate", token, seasonality: this.seasonality.summary() });
      this.store.update((s) => {
        s.stats.aiCalls += 1;
        const current = s.tokens[token.token];
        if (current) {
          current.aiAction = decision.action;
          current.aiConfidence = decision.confidence;
          current.aiReason = decision.reason;
        }
      });

      if (decision.action === "BUY" && shouldOpen(token, decision.confidence, config.minLocalScore)) {
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
    const s = this.store.get();
    const perTrade = config.startingCapitalMon * config.positionSizePct / 100;
    const maxExposure = config.startingCapitalMon * config.maxTotalExposurePct / 100;
    const capacity = Math.max(0, maxExposure - s.openExposureMon);
    const spend = Math.min(perTrade, capacity, Math.max(0, s.balanceMon - config.gasReserveMon)) * aiSizePct;
    if (spend <= 0.001) return;

    const quote = await quoteBuy(this.publicClient, token.token as Address, spend);
    let amountRaw = quote.amountOut;
    let decimals = 18;
    let tx = "PAPER";

    if (config.liveTrading) {
      if (!this.walletClient) throw new Error("No wallet client");
      tx = await buyNative(this.walletClient, token.token as Address, spend, config.slippagePct);
      await this.publicClient.waitForTransactionReceipt({ hash: tx });
      amountRaw = await this.publicClient.readContract({
        address: token.token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [this.account.address]
      }) as bigint;
      decimals = Number(await this.publicClient.readContract({
        address: token.token as Address,
        abi: erc20Abi,
        functionName: "decimals"
      }));
    }

    const id = token.token + ":" + Date.now();
    const position: Position = {
      id,
      token: token.token,
      symbol: token.symbol,
      amountRaw: amountRaw.toString(),
      decimals,
      entryMon: spend,
      entryPriceMon: amountRaw > 0n ? spend / (Number(amountRaw) / 1e18) : 0,
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
  }

  private async managePositions() {
    const positions = Object.values(this.store.get().positions).filter((p) => p.status === "OPEN");
    let unrealized = 0;
    let exposure = 0;

    for (const position of positions) {
      try {
        const amountRaw = config.liveTrading
          ? await this.publicClient.readContract({
              address: position.token as Address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [this.account.address]
            }) as bigint
          : BigInt(position.amountRaw);

        const out = await quoteSell(this.publicClient, position.token as Address, amountRaw);
        position.currentMon = Number(out) / 1e18;
        position.pnlMon = position.currentMon - position.entryMon;
        position.pnlPct = position.entryMon ? position.pnlMon / position.entryMon * 100 : 0;
        position.peakMon = Math.max(position.peakMon, position.currentMon);

        unrealized += position.pnlMon;
        exposure += position.currentMon;

        const exit = shouldClose(position, config.hardStopPct, config.takeProfitPct, config.trailingPct, config.maxHoldMinutes);
        if (exit) await this.closePosition(position, exit);
      } catch (error) {
        this.store.update((s) => { s.stats.lastError = error instanceof Error ? error.message : String(error); });
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
        const decision = await this.brain.decide({ mode: "position", token, position, seasonality: this.seasonality.summary() });
        position.lastAiAt = Date.now();
        position.lastAiAction = decision.action;
        position.lastAiConfidence = decision.confidence;
        position.lastAiReason = decision.reason;
        this.store.update((s) => { s.stats.aiCalls += 1; });

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

      if (config.liveTrading) {
        if (!this.walletClient || !this.account) throw new Error("No live wallet");
        const balance = await this.publicClient.readContract({
          address: position.token as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [this.account.address]
        }) as bigint;
        if (balance === 0n) throw new Error("Token balance is zero");
        tx = await sellToNative(this.walletClient, this.publicClient, position.token as Address, balance, config.slippagePct);
        await this.publicClient.waitForTransactionReceipt({ hash: tx });
        const quote = await quoteSell(this.publicClient, position.token as Address, balance);
        proceeds = Number(quote) / 1e18;
      }

      const pnl = proceeds - position.entryMon;
      const pnlPct = position.entryMon ? pnl / position.entryMon * 100 : 0;
      position.currentMon = proceeds;
      position.pnlMon = pnl;
      position.pnlPct = pnlPct;
      position.closeTx = tx;
      position.closeReason = reason;
      position.status = "CLOSED";

      this.store.update((s) => {
        s.realizedPnlMon += pnl;
        if (pnl >= 0) s.stats.wins += 1; else s.stats.losses += 1;
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
      this.store.update((s) => { s.stats.lastError = position.closeReason; });
    }
    this.emit();
  }

  private async refreshBalance() {
    if (!this.account) return;
    try {
      const balance = await getBalance(this.publicClient, this.account.address);
      this.store.update((s) => { s.balanceMon = balance; });
      this.store.addEquity({ ts: Date.now(), balanceMon: balance, realizedPnlMon: this.store.get().realizedPnlMon });
    } catch (error) {
      this.store.update((s) => { s.stats.lastError = error instanceof Error ? error.message : String(error); });
    }
  }

  private async persist() {
    try { await this.store.save(); }
    catch (error) { this.store.update((s) => { s.stats.lastError = error instanceof Error ? error.message : String(error); }); }
  }
}
