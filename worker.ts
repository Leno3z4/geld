import { DurableObject } from "cloudflare:workers";

interface Env {
  GELD_BOT: DurableObjectNamespace<GeldBot>;
  GELD_STATE: DurableObjectNamespace<GeldState>;

  GELD_API_SECRET?: string;
  GELD_LIVE_TRADING?: string;
  GELD_AUTO_START?: string;

  MONAD_PRIVATE_KEY?: string;
  GEMINI_API_KEYS?: string;
  NADFUN_API_KEY?: string;
  STATE_SYNC_SECRET?: string;
  STATE_SYNC_URL?: string;
  MONAD_RPC_URL?: string;
  MONAD_WS_URL?: string;

  GEMINI_FAST_MODEL?: string;
  GEMINI_ESCALATION_MODEL?: string;
  STARTING_CAPITAL_MON?: string;
  POSITION_SIZE_PCT?: string;
  MAX_TOTAL_EXPOSURE_PCT?: string;
  MAX_OPEN_POSITIONS?: string;
  GAS_RESERVE_MON?: string;
  MIN_LOCAL_SCORE?: string;
  AI_MIN_CONFIDENCE?: string;
  SLIPPAGE_PCT?: string;
  HARD_STOP_LOSS_PCT?: string;
  TAKE_PROFIT_PCT?: string;
  TRAILING_STOP_PCT?: string;
  MAX_HOLD_MINUTES?: string;
  CANDIDATE_MAX_AGE_SECONDS?: string;
  EVENT_BACKFILL_BLOCKS?: string;
  LOG_CHUNK_BLOCKS?: string;
  MAX_LOG_CHUNKS_PER_CYCLE?: string;
  MIN_ESTABLISHED_AGE_MINUTES?: string;
  MIN_LIQUIDITY_USD?: string;
  MIN_HOLDERS?: string;
  MIN_VOLUME_MON?: string;
  DIP_MIN_PCT?: string;
  DIP_MAX_PCT?: string;
  RECOVERY_MIN_PCT?: string;
  TREND_MAX_1H_PCT?: string;
  DISCOVERY_LIMIT?: string;
  AI_CANDIDATE_LIMIT?: string;
  DISCOVERY_POLL_MS?: string;
  PRICE_SAMPLE_MS?: string;
  NADFUN_API_URL?: string;
  EVENT_POLL_MS?: string;
  POSITION_LOOP_MS?: string;
  AI_POSITION_REVIEW_MS?: string;
  AI_FAST_COOLDOWN_MS?: string;
}

function isTrue(value?: string) {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function isAuthorized(request: Request, env: Env) {
  const expected = env.GELD_API_SECRET;
  return Boolean(expected && request.headers.get("x-geld-api-secret") === expected);
}

function hydrateProcessEnv(env: Env) {
  const mapping: Record<string, string | undefined> = {
    LIVE_TRADING: isTrue(env.GELD_LIVE_TRADING) ? "true" : "false",
    AUTO_START: isTrue(env.GELD_AUTO_START) ? "true" : "false",
    MONAD_PRIVATE_KEY: env.MONAD_PRIVATE_KEY,
    GEMINI_API_KEYS: env.GEMINI_API_KEYS,
    NADFUN_API_KEY: env.NADFUN_API_KEY,
    STATE_SYNC_SECRET: env.STATE_SYNC_SECRET,
    STATE_SYNC_URL: env.STATE_SYNC_URL,
    NADFUN_API_URL: env.NADFUN_API_URL,
    MONAD_RPC_URL: env.MONAD_RPC_URL,
    MONAD_WS_URL: env.MONAD_WS_URL,
    GEMINI_FAST_MODEL: env.GEMINI_FAST_MODEL,
    GEMINI_ESCALATION_MODEL: env.GEMINI_ESCALATION_MODEL,
    STARTING_CAPITAL_MON: env.STARTING_CAPITAL_MON,
    POSITION_SIZE_PCT: env.POSITION_SIZE_PCT,
    MAX_TOTAL_EXPOSURE_PCT: env.MAX_TOTAL_EXPOSURE_PCT,
    MAX_OPEN_POSITIONS: env.MAX_OPEN_POSITIONS,
    GAS_RESERVE_MON: env.GAS_RESERVE_MON,
    MIN_LOCAL_SCORE: env.MIN_LOCAL_SCORE,
    AI_MIN_CONFIDENCE: env.AI_MIN_CONFIDENCE,
    SLIPPAGE_PCT: env.SLIPPAGE_PCT,
    HARD_STOP_LOSS_PCT: env.HARD_STOP_LOSS_PCT,
    TAKE_PROFIT_PCT: env.TAKE_PROFIT_PCT,
    TRAILING_STOP_PCT: env.TRAILING_STOP_PCT,
    MAX_HOLD_MINUTES: env.MAX_HOLD_MINUTES,
    CANDIDATE_MAX_AGE_SECONDS: env.CANDIDATE_MAX_AGE_SECONDS,
    EVENT_BACKFILL_BLOCKS: env.EVENT_BACKFILL_BLOCKS,
    LOG_CHUNK_BLOCKS: env.LOG_CHUNK_BLOCKS,
    MAX_LOG_CHUNKS_PER_CYCLE: env.MAX_LOG_CHUNKS_PER_CYCLE,
    MIN_ESTABLISHED_AGE_MINUTES: env.MIN_ESTABLISHED_AGE_MINUTES,
    MIN_LIQUIDITY_USD: env.MIN_LIQUIDITY_USD,
    MIN_HOLDERS: env.MIN_HOLDERS,
    MIN_VOLUME_MON: env.MIN_VOLUME_MON,
    DIP_MIN_PCT: env.DIP_MIN_PCT,
    DIP_MAX_PCT: env.DIP_MAX_PCT,
    RECOVERY_MIN_PCT: env.RECOVERY_MIN_PCT,
    TREND_MAX_1H_PCT: env.TREND_MAX_1H_PCT,
    DISCOVERY_LIMIT: env.DISCOVERY_LIMIT,
    AI_CANDIDATE_LIMIT: env.AI_CANDIDATE_LIMIT,
    DISCOVERY_POLL_MS: env.DISCOVERY_POLL_MS,
    PRICE_SAMPLE_MS: env.PRICE_SAMPLE_MS,
    EVENT_POLL_MS: env.EVENT_POLL_MS,
    POSITION_LOOP_MS: env.POSITION_LOOP_MS,
    AI_POSITION_REVIEW_MS: env.AI_POSITION_REVIEW_MS,
    AI_FAST_COOLDOWN_MS: env.AI_FAST_COOLDOWN_MS
  };

  for (const [key, value] of Object.entries(mapping)) {
    if (value !== undefined) process.env[key] = value;
  }
}

export class GeldState extends DurableObject<Env> {
  async fetch(request: Request) {
    const secret = this.env.STATE_SYNC_SECRET;

    if (!secret || request.headers.get("x-geld-state-secret") !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method === "GET") {
      const value = await this.ctx.storage.get<string>("snapshot");
      return Response.json(value ? JSON.parse(value) : null);
    }

    if (request.method === "POST") {
      const body = await request.text();
      JSON.parse(body);
      await this.ctx.storage.put("snapshot", body);
      return Response.json({ ok: true });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}

export class GeldBot extends DurableObject<Env> {
  private engine: any = null;

  private async getEngine() {
    if (this.engine) return this.engine;

    hydrateProcessEnv(this.env);
    const { TradingEngine } = await import("./src/engine.js");

    this.engine = new TradingEngine();
    await this.engine.init();
    return this.engine;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/__cron") {
      const engine = await this.getEngine();

      if (!engine.snapshot().running && engine.snapshot().stats.startedAt) {
        return Response.json(engine.snapshot());
      }

      if (!engine.snapshot().running) {
        const autoStart = isTrue(this.env.GELD_AUTO_START);
        if (!autoStart) return Response.json(engine.snapshot());
      }

      if (!engine.snapshot().running) {
        await engine.startScheduled();
      } else {
        await engine.runScheduledCycle();
      }

      return Response.json(engine.snapshot());
    }

    if (!isAuthorized(request, this.env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const engine = await this.getEngine();

    if (path === "/api/health" || path === "/api/state") {
      const state = engine.snapshot();

      if (path === "/api/health") {
        return Response.json({
          ok: true,
          running: state.running,
          liveTrading: state.liveTrading,
          walletAddress: state.walletAddress,
          balanceMon: state.balanceMon,
          openPositions: Object.values(state.positions).filter((p: any) => p.status === "OPEN").length,
          chainId: 143,
          lastCycleAt: state.stats.lastCycleAt ?? 0
        });
      }

      return Response.json(state);
    }

    if (path === "/api/positions") {
      return Response.json(Object.values(engine.snapshot().positions));
    }

    if (path === "/api/tokens") {
      return Response.json(
        Object.values(engine.snapshot().tokens)
          .sort((a: any, b: any) => b.localScore - a.localScore)
          .slice(0, 100)
      );
    }

    if (path === "/api/trades") {
      return Response.json(engine.snapshot().trades);
    }

    if (request.method === "POST" && path === "/api/start") {
      await engine.startScheduled();
      return Response.json({ ok: true, state: engine.snapshot() });
    }

    if (request.method === "POST" && path === "/api/stop") {
      await engine.stop();
      return Response.json({ ok: true, state: engine.snapshot() });
    }

    if (request.method === "POST" && path === "/api/sell-all") {
      await engine.sellAll();
      return Response.json({ ok: true, state: engine.snapshot() });
    }

    if (path === "/api/events") {
      return Response.json(engine.snapshot());
    }

    return new Response("Not Found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/internal/state/")) {
      const id = env.GELD_STATE.idFromName("singleton");
      const innerPath = url.pathname.replace("/internal/state", "") || "/";
      return env.GELD_STATE.get(id).fetch(new Request(new URL(innerPath, url), request));
    }

    if (!isAuthorized(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const id = env.GELD_BOT.idFromName("singleton");
    return env.GELD_BOT.get(id).fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env) {
    const id = env.GELD_BOT.idFromName("singleton");
    await env.GELD_BOT.get(id).fetch(
      new Request("https://geld.internal/__cron", { method: "POST" })
    );
  }
};
