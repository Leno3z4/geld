import fs from "node:fs/promises";
import path from "node:path";
import type { BotState, EquityPoint, Position, TokenSnapshot, TradeRecord } from "./types.js";
import { config } from "./config.js";

const MAX_REMOTE_SNAPSHOT_BYTES = 750 * 1024;
const MAX_PERSISTED_TOKENS = 250;
const MAX_PERSISTED_TRADES = 150;
const MAX_PERSISTED_EQUITY = 336;
const MAX_TOKEN_PRICE_HISTORY = 96;
const MAX_TOKEN_FLOW_HISTORY = 48;
const MAX_TOKEN_PROGRESS_HISTORY = 48;

function initialState(): BotState {
  return {
    version: 1,
    running: false,
    liveTrading: config.liveTrading,
    walletAddress: "",
    balanceMon: 0,
    realizedPnlMon: 0,
    unrealizedPnlMon: 0,
    openExposureMon: 0,
    seasonality: {},
    tokens: {},
    positions: {},
    trades: [],
    pendingExecutions: {},
    equity: [],
    stats: { aiCalls: 0, aiFailures: 0, eventCount: 0, wins: 0, losses: 0, lastAiError: undefined, lastAiFailureAt: undefined, lastIdleReason: undefined, dailyRiskDrawdownPct: 0 }
  };
}

function truncate(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function tokenForPersistence(token: TokenSnapshot): TokenSnapshot {
  // Keep the current trading/market state while bounding all high-frequency
  // histories and externally supplied strings. Daily high/low fields remain
  // intact; long-term learning is stored in its dedicated DO.
  return {
    ...token,
    symbol: truncate(token.symbol, 64) ?? "?",
    name: truncate(token.name, 160) ?? "Unknown",
    creator: truncate(token.creator, 64) ?? "",
    pair: truncate(token.pair, 64) ?? "",
    pairToken0: truncate(token.pairToken0, 64),
    pairToken1: truncate(token.pairToken1, 64),
    quoteToken: truncate(token.quoteToken, 64),
    watchReason: truncate(token.watchReason, 180),
    aiReason: truncate(token.aiReason, 320),
    lastBuyTx: truncate(token.lastBuyTx, 128),
    progressHistory: token.progressHistory?.slice(-MAX_TOKEN_PROGRESS_HISTORY),
    flowHistory: token.flowHistory?.slice(-MAX_TOKEN_FLOW_HISTORY),
    priceHistory: token.priceHistory?.slice(-MAX_TOKEN_PRICE_HISTORY),
    entryDiagnostics: token.entryDiagnostics
      ? {
          ...token.entryDiagnostics,
          primary: truncate(token.entryDiagnostics.primary, 160) ?? "",
          blockers: token.entryDiagnostics.blockers.slice(0, 8).map((x) => truncate(x, 160) ?? ""),
        }
      : undefined,
  };
}

function compactState(state: BotState): BotState {
  state.version = 1;
  state.pendingExecutions ??= {};

  // Never discard tokens that are attached to an active position. For the
  // rest, persist the most recently active/high-scoring observations only.
  const activeTokenKeys = new Set(
    Object.values(state.positions)
      .filter((position) => position.status === "OPEN" || position.status === "CLOSING")
      .map((position) => position.token.toLowerCase())
  );

  const tokens = Object.values(state.tokens)
    .map(tokenForPersistence)
    .sort((a, b) => {
      const aActive = activeTokenKeys.has(a.token.toLowerCase()) ? 1 : 0;
      const bActive = activeTokenKeys.has(b.token.toLowerCase()) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;

      const aActivity = Math.max(a.lastEventAt ?? 0, a.lastMarketAt ?? 0, a.lastFlowApiAt ?? 0);
      const bActivity = Math.max(b.lastEventAt ?? 0, b.lastMarketAt ?? 0, b.lastFlowApiAt ?? 0);
      if (aActivity !== bActivity) return bActivity - aActivity;
      return (b.localScore ?? 0) - (a.localScore ?? 0);
    });

  state.tokens = Object.fromEntries(
    tokens.slice(0, MAX_PERSISTED_TOKENS).map((token) => [token.token.toLowerCase(), token])
  );

  state.trades = state.trades.slice(0, MAX_PERSISTED_TRADES);
  state.equity = state.equity.slice(-MAX_PERSISTED_EQUITY);

  // Bound pending execution metadata as a last-resort protection against a
  // failed/retried execution path filling the snapshot indefinitely. Active
  // pending executions are retained; stale entries are removed first.
  const pending = Object.values(state.pendingExecutions)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
  state.pendingExecutions = Object.fromEntries(pending.map((item) => [item.id, item]));

  state.stats.lastError = truncate(state.stats.lastError, 500);
  state.stats.lastAiError = truncate(state.stats.lastAiError, 500);
  state.stats.lastIdleReason = truncate(state.stats.lastIdleReason, 500);
  state.stats.lastScheduledError = truncate(state.stats.lastScheduledError, 500);

  return state;
}

function serializedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function buildSnapshot(state: BotState): { body: string; bytes: number } {
  compactState(state);
  const body = JSON.stringify(state);
  return { body, bytes: serializedBytes(body) };
}

export class StateStore {
  private state: BotState = initialState();

  async load() {
    let local: BotState | null = null;

    try {
      const raw = await fs.readFile(config.stateFile, "utf8");
      const parsed = JSON.parse(raw) as BotState;
      if (parsed?.version === 1) local = compactState(parsed);
    } catch {}

    if (local) this.state = local;

    // Migrate state written by older builds before pending execution tracking.
    this.state.pendingExecutions ??= {};

    if (config.stateSyncUrl) {
      try {
        const response = await fetch(config.stateSyncUrl, {
          headers: { "x-geld-state-secret": config.stateSyncSecret }
        });

        if (response.ok) {
          const remote = await response.json() as BotState | null;

          if (remote?.version === 1) {
            remote.pendingExecutions ??= {};
            compactState(remote);

            const remoteAge = Math.max(
              remote.stats.startedAt ?? 0,
              remote.trades[0]?.ts ?? 0,
              remote.equity.at(-1)?.ts ?? 0
            );
            const localAge = Math.max(
              this.state.stats.startedAt ?? 0,
              this.state.trades[0]?.ts ?? 0,
              this.state.equity.at(-1)?.ts ?? 0
            );

            if (!local || remoteAge >= localAge) this.state = remote;
          }
        }
      } catch {}
    }
  }

  get() {
    return this.state;
  }

  update(fn: (s: BotState) => void) {
    fn(this.state);
  }

  upsertToken(token: TokenSnapshot) {
    this.state.tokens[token.token.toLowerCase()] = token;
  }

  upsertPosition(position: Position) {
    this.state.positions[position.id] = position;
  }

  addTrade(trade: TradeRecord) {
    this.state.trades.unshift(trade);
    this.state.trades = this.state.trades.slice(0, 250);
  }

  addEquity(point: EquityPoint) {
    this.state.equity.push(point);
    this.state.equity = this.state.equity.slice(-720);
  }

  async save() {
    const { body, bytes } = buildSnapshot(this.state);

    if (bytes > MAX_REMOTE_SNAPSHOT_BYTES) {
      // compactState is intentionally deterministic and bounded. This is a
      // hard fail-closed guard so a future schema change cannot silently turn
      // the Durable Object snapshot into SQLITE_TOOBIG.
      throw new Error(
        `State snapshot exceeds safe persistence limit: ${bytes} bytes > ${MAX_REMOTE_SNAPSHOT_BYTES}`
      );
    }

    try {
      await fs.mkdir(path.dirname(config.stateFile), { recursive: true });
      await fs.writeFile(config.stateFile, body);
    } catch {
      // Container disk is disposable; remote state is the durable source of truth.
    }

    if (config.stateSyncUrl) {
      const response = await fetch(config.stateSyncUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-geld-state-secret": config.stateSyncSecret,
          "x-geld-state-bytes": String(bytes)
        },
        body
      });

      if (!response.ok) {
        throw new Error("State sync failed: HTTP " + response.status);
      }
    }
  }
}
