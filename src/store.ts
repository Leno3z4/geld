import fs from "node:fs/promises";
import path from "node:path";
import type { BotState, EquityPoint, Position, TokenSnapshot, TradeRecord } from "./types.js";
import { config } from "./config.js";

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
    equity: [],
    stats: { aiCalls: 0, aiFailures: 0, eventCount: 0, wins: 0, losses: 0 }
  };
}

export class StateStore {
  private state: BotState = initialState();

  async load() {
    let local: BotState | null = null;

    try {
      const raw = await fs.readFile(config.stateFile, "utf8");
      const parsed = JSON.parse(raw) as BotState;
      if (parsed?.version === 1) local = parsed;
    } catch {}

    if (local) this.state = local;

    if (config.stateSyncUrl) {
      try {
        const response = await fetch(config.stateSyncUrl, {
          headers: { "x-geld-state-secret": config.stateSyncSecret }
        });

        if (response.ok) {
          const remote = await response.json() as BotState | null;

          if (remote?.version === 1) {
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
    const body = JSON.stringify(this.state, null, 2);

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
          "x-geld-state-secret": config.stateSyncSecret
        },
        body
      });

      if (!response.ok) {
        throw new Error("State sync failed: HTTP " + response.status);
      }
    }
  }
}
