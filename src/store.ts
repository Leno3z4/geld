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
    try {
      const raw = await fs.readFile(config.stateFile, "utf8");
      const parsed = JSON.parse(raw) as BotState;
      if (parsed?.version === 1) this.state = parsed;
    } catch {}

    if (config.stateSyncUrl) {
      try {
        const r = await fetch(config.stateSyncUrl, { headers: { "x-geld-state-secret": config.stateSyncSecret } });
        if (r.ok) {
          const remote = await r.json() as BotState | null;
          if (remote?.version === 1 && remote.equity.length >= this.state.equity.length) this.state = remote;
        }
      } catch {}
    }
  }

  get() { return this.state; }
  update(fn: (s: BotState) => void) { fn(this.state); }

  upsertToken(token: TokenSnapshot) { this.state.tokens[token.token.toLowerCase()] = token; }
  upsertPosition(position: Position) { this.state.positions[position.id] = position; }

  addTrade(trade: TradeRecord) {
    this.state.trades.unshift(trade);
    this.state.trades = this.state.trades.slice(0, 250);
  }

  addEquity(point: EquityPoint) {
    this.state.equity.push(point);
    this.state.equity = this.state.equity.slice(-720);
  }

  async save() {
    await fs.mkdir(path.dirname(config.stateFile), { recursive: true });
    await fs.writeFile(config.stateFile, JSON.stringify(this.state, null, 2));
    if (config.stateSyncUrl) {
      try {
        await fetch(config.stateSyncUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-geld-state-secret": config.stateSyncSecret
          },
          body: JSON.stringify(this.state)
        });
      } catch {}
    }
  }
}
