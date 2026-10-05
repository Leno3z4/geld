import { DurableObject } from "cloudflare:workers";
import { GeldHighCapLearning } from "./src/highcap-learning.js";
import { GeldLeverUpPaper } from "./src/leverup-paper.js";
import { scanLSTArbitrage } from "./src/lst-arbitrage.js";

interface Env {
  GELD_BOT: DurableObjectNamespace<GeldBot>;
  GELD_STATE: DurableObjectNamespace<GeldState>;
  GELD_HIGHCAP_LEARNING: DurableObjectNamespace<GeldHighCapLearning>;
  GELD_LEVERUP_PAPER: DurableObjectNamespace<GeldLeverUpPaper>;

  GELD_API_SECRET?: string;
  GELD_CONFIG?: string;
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
  DAILY_LOSS_LIMIT_PCT?: string;
  EARLY_LAUNCH_ENABLED?: string;
  EARLY_LAUNCH_MIN_AGE_SECONDS?: string;
  EARLY_LAUNCH_MAX_AGE_MINUTES?: string;
  EARLY_LAUNCH_MIN_MARKET_CAP_USD?: string;
  EARLY_LAUNCH_MAX_MARKET_CAP_USD?: string;
  EARLY_LAUNCH_MIN_LIQUIDITY_USD?: string;
  EARLY_LAUNCH_MIN_HOLDERS?: string;
  EARLY_LAUNCH_MIN_VOLUME_1M_USD?: string;
  EARLY_LAUNCH_MIN_BUY_SELL_1M?: string;
  EARLY_LAUNCH_MIN_UNIQUE_BUYERS_1M?: string;
  EARLY_LAUNCH_MAX_TOP_BUYER_SHARE_1M?: string;
  EARLY_LAUNCH_MIN_TREND_1M_PCT?: string;
  EARLY_LAUNCH_MIN_CURVE_VELOCITY_PCT_PER_MIN?: string;
  EARLY_LAUNCH_MAX_TREND_1M_PCT?: string;
  EARLY_LAUNCH_MIN_SCORE?: string;
  EARLY_LAUNCH_PROBE_PORTFOLIO_PCT?: string;
  NEW_EVENT_POLL_MS?: string;
  NEW_EVENT_CANDIDATE_LIMIT?: string;
  MIN_LOCAL_SCORE?: string;
  AI_MIN_CONFIDENCE?: string;
  SLIPPAGE_PCT?: string;
  SELL_GAS_LIMIT?: string;
  SELL_GAS_PADDING_PCT?: string;
  SELL_FAILURE_COOLDOWN_MS?: string;
  SELL_FAILURE_QUARANTINE_MS?: string;
  SELL_FAILURE_QUARANTINE_COUNT?: string;
  AI_MAX_CALLS_PER_CYCLE?: string;
  AI_MAX_CALLS_PER_DAY?: string;
  AI_MAX_ATTEMPTS_PER_DECISION?: string;
  REENTRY_COOLDOWN_MS?: string;
  HIGH_CAP_MIN_MARKET_CAP_USD?: string;
  HIGH_CAP_MIN_VOLUME_5M_USD?: string;
  HIGH_CAP_MIN_BUY_SELL_RATIO_5M?: string;
  HIGH_CAP_MIN_BUY_MAKERS_5M?: string;
  HIGH_CAP_MIN_TREND_4H_PCT?: string;
  HARD_STOP_LOSS_PCT?: string;
  TAKE_PROFIT_PCT?: string;
  TRAILING_STOP_PCT?: string;
  MAX_HOLD_MINUTES?: string;
  PROFIT_TAKE_1_PCT?: string;
  PROFIT_TAKE_1_SELL_PCT?: string;
  PROFIT_TAKE_2_PCT?: string;
  PROFIT_TAKE_2_SELL_PCT?: string;
  PROFIT_TAKE_3_PCT?: string;
  PROFIT_TAKE_3_SELL_PCT?: string;
  PROFIT_PROTECTION_START_PCT?: string;
  PROFIT_PROTECTION_FLOOR_PCT?: string;
  PROFIT_PROTECTION_RATIO?: string;
  EARLY_EXIT_LOSS_PCT?: string;
  EARLY_EXIT_TREND_1H_PCT?: string;
  MOMENTUM_EXIT_PROFIT_PCT?: string;
  MOMENTUM_EXIT_TREND_1H_PCT?: string;
  MOMENTUM_EXIT_REBOUND_1H_PCT?: string;
  SELL_PRESSURE_EXIT_RATIO?: string;
  SELL_PRESSURE_MIN_VOLUME_USD?: string;
  MIN_TREND_4H_PCT?: string;
  LIQUIDITY_EXIT_RATIO?: string;
  MAX_QUOTE_FAILURES?: string;
  CANDIDATE_MAX_AGE_SECONDS?: string;
  EVENT_BACKFILL_BLOCKS?: string;
  LOG_CHUNK_BLOCKS?: string;
  MAX_LOG_CHUNKS_PER_CYCLE?: string;
  MIN_ESTABLISHED_AGE_MINUTES?: string;
  MIN_LIQUIDITY_USD?: string;
  MIN_HOLDERS?: string;
  MIN_VOLUME_USD?: string;
  DIP_MIN_PCT?: string;
  DIP_MAX_PCT?: string;
  RECOVERY_MIN_PCT?: string;
  DIP_MIN_REBOUND_PCT?: string;
  DIP_MIN_BUY_SELL_RATIO_5M?: string;
  DIP_MIN_VOLUME_5M_USD?: string;
  DIP_MAX_TREND_1H_PCT?: string;
  TREND_MAX_1H_PCT?: string;
  DISCOVERY_LIMIT?: string;
  AI_CANDIDATE_LIMIT?: string;
  AI_CANDIDATE_COOLDOWN_MS?: string;
  DISCOVERY_POLL_MS?: string;
  PRICE_SAMPLE_MS?: string;
  NADFUN_API_URL?: string;
  NADFUN_SITE_URL?: string;
  EVENT_POLL_MS?: string;
  POSITION_LOOP_MS?: string;
  AI_POSITION_REVIEW_MS?: string;
  AI_FAST_COOLDOWN_MS?: string;
  AI_FALLBACK_ENABLED?: string;
  AI_FALLBACK_MIN_SCORE?: string;
  AI_OVERRIDE_SCORE?: string;
  STALE_LOSS_EXIT_MINUTES?: string;
  STALE_LOSS_EXIT_PCT?: string;
  DEAD_MONEY_EXIT_MINUTES?: string;
  DEAD_MONEY_MAX_PNL_PCT?: string;
  DUST_POSITION_MON?: string;
  DAILY_MEAN_EXIT_PCT?: string;
  DAILY_MIN_SAMPLES?: string;
  FAST_CYCLE_MS?: string;
  PENDING_EXECUTION_TIMEOUT_MS?: string;
  LOW_CAP_MOMENTUM_ENABLED?: string;
  LOW_CAP_MIN_MARKET_CAP_USD?: string;
  LOW_CAP_MAX_MARKET_CAP_USD?: string;
  LOW_CAP_MIN_LIQUIDITY_USD?: string;
  LOW_CAP_MIN_HOLDERS?: string;
  LOW_CAP_MIN_VOLUME_USD?: string;
  MIN_VOLUME_5M_USD?: string;
  LOW_CAP_MIN_AGE_MINUTES?: string;
  LOW_CAP_CANDIDATE_MAX_AGE_SECONDS?: string;
  LOW_CAP_MIN_BUY_SELL_RATIO_5M?: string;
  LOW_CAP_MIN_VOLUME_5M_USD?: string;
  LOW_CAP_MIN_VOLUME_ACCELERATION_5M?: string;
  LOW_CAP_MIN_TREND_1H_PCT?: string;
  LOW_CAP_MIN_SCORE?: string;
  LOW_CAP_LIQUIDITY_EXIT_RATIO?: string;
  LOW_CAP_SELL_PRESSURE_RATIO?: string;
  LOW_CAP_SELL_PRESSURE_MIN_VOLUME_USD?: string;
  LOW_CAP_TREND_EXIT_PCT?: string;
  LOW_CAP_LOSS_EXIT_PCT?: string;
  LOW_CAP_PEAK_DRAWDOWN_EXIT_PCT?: string;
  LOW_CAP_MAX_LIQUIDITY_POSITION_PCT?: string;
  LOW_CAP_FLOW_API_CANDIDATE_LIMIT?: string;
  FLOW_API_REFRESH_MS?: string;
  LEVERUP_ENABLED?: string;
  LEVERUP_DIAMOND?: string;
  LEVERUP_AGENT_PRIVATE_KEY?: string;
  LEVERUP_AGENT_PERMISSION_MASK?: string;
  LEVERUP_PYTH_HERMES_URL?: string;
  PYTH_API_KEY?: string;
  LEVERUP_DEFAULT_LEVERAGE?: string;
  LEVERUP_MAX_LEVERAGE?: string;
  LEVERUP_MIN_NOTIONAL_USD?: string;
  LEVERUP_MIN_MARGIN_USD?: string;
  LEVERUP_MAX_MARGIN_PCT?: string;
  LEVERUP_RISK_PER_TRADE_PCT?: string;
  LEVERUP_DAILY_LOSS_LIMIT_PCT?: string;
  LEVERUP_MAX_CONSECUTIVE_LOSSES?: string;
  LEVERUP_COOLDOWN_MS?: string;
  LEVERUP_AUTO_LIVE_AFTER_PAPER?: string;
}

function isTrue(value?: string) {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

const PUBLIC_API_GET_PATHS = new Set([
  "/api/health",
  "/api/state",
  "/api/config",
  "/api/positions",
  "/api/tokens",
  "/api/trades",
  "/api/events",
  "/api/leverup/paper",
  "/api/leverup/preflight",
  "/api/lst/arbitrage"
]);

function isAuthorized(request: Request, env: Env) {
  const expected = env.GELD_API_SECRET;
  return Boolean(expected && request.headers.get("x-geld-api-secret") === expected);
}

function isPublicApiRead(request: Request) {
  return request.method === "GET" && PUBLIC_API_GET_PATHS.has(new URL(request.url).pathname);
}

function withCors(response: Response, request: Request) {
  if (!isPublicApiRead(request) && request.method !== "OPTIONS") return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
  headers.set("Cache-Control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function parseGeldConfig(env: Env): Record<string, string | undefined> {
  if (!env.GELD_CONFIG) return {};

  try {
    const parsed = JSON.parse(env.GELD_CONFIG) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("GELD_CONFIG must be a JSON object");
    }

    const config: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      config[key] = typeof value === "string" ? value : String(value);
    }
    return config;
  } catch (error) {
    console.error("Invalid GELD_CONFIG:", error);
    return {};
  }
}

function hydrateProcessEnv(env: Env) {
  const config = parseGeldConfig(env);

  const valueFor = (key: string, fallback?: string) =>
    config[key] !== undefined ? config[key] : fallback;

  const mapping: Record<string, string | undefined> = {
    LIVE_TRADING: valueFor("GELD_LIVE_TRADING", env.GELD_LIVE_TRADING) ?? "false",
    AUTO_START: valueFor("GELD_AUTO_START", env.GELD_AUTO_START) ?? "false",
    MONAD_PRIVATE_KEY: env.MONAD_PRIVATE_KEY,
    GEMINI_API_KEYS: env.GEMINI_API_KEYS,
    NADFUN_API_KEY: env.NADFUN_API_KEY,
    STATE_SYNC_SECRET: env.STATE_SYNC_SECRET,
    STATE_SYNC_URL: valueFor("STATE_SYNC_URL", env.STATE_SYNC_URL),
    NADFUN_API_URL: valueFor("NADFUN_API_URL", env.NADFUN_API_URL),
    NADFUN_SITE_URL: valueFor("NADFUN_SITE_URL", env.NADFUN_SITE_URL),
    MONAD_RPC_URL: valueFor("MONAD_RPC_URL", env.MONAD_RPC_URL),
    MONAD_WS_URL: valueFor("MONAD_WS_URL", env.MONAD_WS_URL),
    GEMINI_FAST_MODEL: valueFor("GEMINI_FAST_MODEL", env.GEMINI_FAST_MODEL),
    GEMINI_ESCALATION_MODEL: valueFor("GEMINI_ESCALATION_MODEL", env.GEMINI_ESCALATION_MODEL),
    STARTING_CAPITAL_MON: valueFor("STARTING_CAPITAL_MON", env.STARTING_CAPITAL_MON),
    POSITION_SIZE_PCT: valueFor("POSITION_SIZE_PCT", env.POSITION_SIZE_PCT),
    MAX_TOTAL_EXPOSURE_PCT: valueFor("MAX_TOTAL_EXPOSURE_PCT", env.MAX_TOTAL_EXPOSURE_PCT),
    MAX_OPEN_POSITIONS: valueFor("MAX_OPEN_POSITIONS", env.MAX_OPEN_POSITIONS),
    GAS_RESERVE_MON: valueFor("GAS_RESERVE_MON", env.GAS_RESERVE_MON),
    DAILY_LOSS_LIMIT_PCT: valueFor("DAILY_LOSS_LIMIT_PCT", env.DAILY_LOSS_LIMIT_PCT),
    EARLY_LAUNCH_ENABLED: valueFor("EARLY_LAUNCH_ENABLED", env.EARLY_LAUNCH_ENABLED),
    EARLY_LAUNCH_MIN_AGE_SECONDS: valueFor("EARLY_LAUNCH_MIN_AGE_SECONDS", env.EARLY_LAUNCH_MIN_AGE_SECONDS),
    EARLY_LAUNCH_MAX_AGE_MINUTES: valueFor("EARLY_LAUNCH_MAX_AGE_MINUTES", env.EARLY_LAUNCH_MAX_AGE_MINUTES),
    EARLY_LAUNCH_MIN_MARKET_CAP_USD: valueFor("EARLY_LAUNCH_MIN_MARKET_CAP_USD", env.EARLY_LAUNCH_MIN_MARKET_CAP_USD),
    EARLY_LAUNCH_MAX_MARKET_CAP_USD: valueFor("EARLY_LAUNCH_MAX_MARKET_CAP_USD", env.EARLY_LAUNCH_MAX_MARKET_CAP_USD),
    EARLY_LAUNCH_MIN_LIQUIDITY_USD: valueFor("EARLY_LAUNCH_MIN_LIQUIDITY_USD", env.EARLY_LAUNCH_MIN_LIQUIDITY_USD),
    EARLY_LAUNCH_MIN_HOLDERS: valueFor("EARLY_LAUNCH_MIN_HOLDERS", env.EARLY_LAUNCH_MIN_HOLDERS),
    EARLY_LAUNCH_MIN_VOLUME_1M_USD: valueFor("EARLY_LAUNCH_MIN_VOLUME_1M_USD", env.EARLY_LAUNCH_MIN_VOLUME_1M_USD),
    EARLY_LAUNCH_MIN_BUY_SELL_1M: valueFor("EARLY_LAUNCH_MIN_BUY_SELL_1M", env.EARLY_LAUNCH_MIN_BUY_SELL_1M),
    EARLY_LAUNCH_MIN_UNIQUE_BUYERS_1M: valueFor("EARLY_LAUNCH_MIN_UNIQUE_BUYERS_1M", env.EARLY_LAUNCH_MIN_UNIQUE_BUYERS_1M),
    EARLY_LAUNCH_MAX_TOP_BUYER_SHARE_1M: valueFor("EARLY_LAUNCH_MAX_TOP_BUYER_SHARE_1M", env.EARLY_LAUNCH_MAX_TOP_BUYER_SHARE_1M),
    EARLY_LAUNCH_MIN_TREND_1M_PCT: valueFor("EARLY_LAUNCH_MIN_TREND_1M_PCT", env.EARLY_LAUNCH_MIN_TREND_1M_PCT),
    EARLY_LAUNCH_MIN_CURVE_VELOCITY_PCT_PER_MIN: valueFor("EARLY_LAUNCH_MIN_CURVE_VELOCITY_PCT_PER_MIN", env.EARLY_LAUNCH_MIN_CURVE_VELOCITY_PCT_PER_MIN),
    EARLY_LAUNCH_MAX_TREND_1M_PCT: valueFor("EARLY_LAUNCH_MAX_TREND_1M_PCT", env.EARLY_LAUNCH_MAX_TREND_1M_PCT),
    EARLY_LAUNCH_MIN_SCORE: valueFor("EARLY_LAUNCH_MIN_SCORE", env.EARLY_LAUNCH_MIN_SCORE),
    EARLY_LAUNCH_PROBE_PORTFOLIO_PCT: valueFor("EARLY_LAUNCH_PROBE_PORTFOLIO_PCT", env.EARLY_LAUNCH_PROBE_PORTFOLIO_PCT),
    NEW_EVENT_POLL_MS: valueFor("NEW_EVENT_POLL_MS", env.NEW_EVENT_POLL_MS),
    NEW_EVENT_CANDIDATE_LIMIT: valueFor("NEW_EVENT_CANDIDATE_LIMIT", env.NEW_EVENT_CANDIDATE_LIMIT),
    MIN_LOCAL_SCORE: valueFor("MIN_LOCAL_SCORE", env.MIN_LOCAL_SCORE),
    AI_MIN_CONFIDENCE: valueFor("AI_MIN_CONFIDENCE", env.AI_MIN_CONFIDENCE),
    SLIPPAGE_PCT: valueFor("SLIPPAGE_PCT", env.SLIPPAGE_PCT),
    SELL_GAS_LIMIT: valueFor("SELL_GAS_LIMIT", env.SELL_GAS_LIMIT),
    SELL_GAS_PADDING_PCT: valueFor("SELL_GAS_PADDING_PCT", env.SELL_GAS_PADDING_PCT),
    SELL_FAILURE_COOLDOWN_MS: valueFor("SELL_FAILURE_COOLDOWN_MS", env.SELL_FAILURE_COOLDOWN_MS),
    SELL_FAILURE_QUARANTINE_MS: valueFor("SELL_FAILURE_QUARANTINE_MS", env.SELL_FAILURE_QUARANTINE_MS),
    SELL_FAILURE_QUARANTINE_COUNT: valueFor("SELL_FAILURE_QUARANTINE_COUNT", env.SELL_FAILURE_QUARANTINE_COUNT),
    AI_MAX_CALLS_PER_CYCLE: valueFor("AI_MAX_CALLS_PER_CYCLE", env.AI_MAX_CALLS_PER_CYCLE),
    AI_MAX_CALLS_PER_DAY: valueFor("AI_MAX_CALLS_PER_DAY", env.AI_MAX_CALLS_PER_DAY),
    AI_MAX_ATTEMPTS_PER_DECISION: valueFor("AI_MAX_ATTEMPTS_PER_DECISION", env.AI_MAX_ATTEMPTS_PER_DECISION),
    REENTRY_COOLDOWN_MS: valueFor("REENTRY_COOLDOWN_MS", env.REENTRY_COOLDOWN_MS),
    HIGH_CAP_MIN_MARKET_CAP_USD: valueFor("HIGH_CAP_MIN_MARKET_CAP_USD", env.HIGH_CAP_MIN_MARKET_CAP_USD),
    HIGH_CAP_MIN_VOLUME_5M_USD: valueFor("HIGH_CAP_MIN_VOLUME_5M_USD", env.HIGH_CAP_MIN_VOLUME_5M_USD),
    HIGH_CAP_MIN_BUY_SELL_RATIO_5M: valueFor("HIGH_CAP_MIN_BUY_SELL_RATIO_5M", env.HIGH_CAP_MIN_BUY_SELL_RATIO_5M),
    HIGH_CAP_MIN_BUY_MAKERS_5M: valueFor("HIGH_CAP_MIN_BUY_MAKERS_5M", env.HIGH_CAP_MIN_BUY_MAKERS_5M),
    HIGH_CAP_MIN_TREND_4H_PCT: valueFor("HIGH_CAP_MIN_TREND_4H_PCT", env.HIGH_CAP_MIN_TREND_4H_PCT),
    HARD_STOP_LOSS_PCT: valueFor("HARD_STOP_LOSS_PCT", env.HARD_STOP_LOSS_PCT),
    TAKE_PROFIT_PCT: valueFor("TAKE_PROFIT_PCT", env.TAKE_PROFIT_PCT),
    TRAILING_STOP_PCT: valueFor("TRAILING_STOP_PCT", env.TRAILING_STOP_PCT),
    MAX_HOLD_MINUTES: valueFor("MAX_HOLD_MINUTES", env.MAX_HOLD_MINUTES),
    PROFIT_TAKE_1_PCT: valueFor("PROFIT_TAKE_1_PCT", env.PROFIT_TAKE_1_PCT),
    PROFIT_TAKE_1_SELL_PCT: valueFor("PROFIT_TAKE_1_SELL_PCT", env.PROFIT_TAKE_1_SELL_PCT),
    PROFIT_TAKE_2_PCT: valueFor("PROFIT_TAKE_2_PCT", env.PROFIT_TAKE_2_PCT),
    PROFIT_TAKE_2_SELL_PCT: valueFor("PROFIT_TAKE_2_SELL_PCT", env.PROFIT_TAKE_2_SELL_PCT),
    PROFIT_TAKE_3_PCT: valueFor("PROFIT_TAKE_3_PCT", env.PROFIT_TAKE_3_PCT),
    PROFIT_TAKE_3_SELL_PCT: valueFor("PROFIT_TAKE_3_SELL_PCT", env.PROFIT_TAKE_3_SELL_PCT),
    PROFIT_PROTECTION_START_PCT: valueFor("PROFIT_PROTECTION_START_PCT", env.PROFIT_PROTECTION_START_PCT),
    PROFIT_PROTECTION_FLOOR_PCT: valueFor("PROFIT_PROTECTION_FLOOR_PCT", env.PROFIT_PROTECTION_FLOOR_PCT),
    PROFIT_PROTECTION_RATIO: valueFor("PROFIT_PROTECTION_RATIO", env.PROFIT_PROTECTION_RATIO),
    EARLY_EXIT_LOSS_PCT: valueFor("EARLY_EXIT_LOSS_PCT", env.EARLY_EXIT_LOSS_PCT),
    EARLY_EXIT_TREND_1H_PCT: valueFor("EARLY_EXIT_TREND_1H_PCT", env.EARLY_EXIT_TREND_1H_PCT),
    MOMENTUM_EXIT_PROFIT_PCT: valueFor("MOMENTUM_EXIT_PROFIT_PCT", env.MOMENTUM_EXIT_PROFIT_PCT),
    MOMENTUM_EXIT_TREND_1H_PCT: valueFor("MOMENTUM_EXIT_TREND_1H_PCT", env.MOMENTUM_EXIT_TREND_1H_PCT),
    MOMENTUM_EXIT_REBOUND_1H_PCT: valueFor("MOMENTUM_EXIT_REBOUND_1H_PCT", env.MOMENTUM_EXIT_REBOUND_1H_PCT),
    SELL_PRESSURE_EXIT_RATIO: valueFor("SELL_PRESSURE_EXIT_RATIO", env.SELL_PRESSURE_EXIT_RATIO),
    SELL_PRESSURE_MIN_VOLUME_USD: valueFor("SELL_PRESSURE_MIN_VOLUME_USD", env.SELL_PRESSURE_MIN_VOLUME_USD),
    MIN_TREND_4H_PCT: valueFor("MIN_TREND_4H_PCT", env.MIN_TREND_4H_PCT),
    LIQUIDITY_EXIT_RATIO: valueFor("LIQUIDITY_EXIT_RATIO", env.LIQUIDITY_EXIT_RATIO),
    MAX_QUOTE_FAILURES: valueFor("MAX_QUOTE_FAILURES", env.MAX_QUOTE_FAILURES),
    CANDIDATE_MAX_AGE_SECONDS: valueFor("CANDIDATE_MAX_AGE_SECONDS", env.CANDIDATE_MAX_AGE_SECONDS),
    EVENT_BACKFILL_BLOCKS: valueFor("EVENT_BACKFILL_BLOCKS", env.EVENT_BACKFILL_BLOCKS),
    LOG_CHUNK_BLOCKS: valueFor("LOG_CHUNK_BLOCKS", env.LOG_CHUNK_BLOCKS),
    MAX_LOG_CHUNKS_PER_CYCLE: valueFor("MAX_LOG_CHUNKS_PER_CYCLE", env.MAX_LOG_CHUNKS_PER_CYCLE),
    MIN_ESTABLISHED_AGE_MINUTES: valueFor("MIN_ESTABLISHED_AGE_MINUTES", env.MIN_ESTABLISHED_AGE_MINUTES),
    MIN_LIQUIDITY_USD: valueFor("MIN_LIQUIDITY_USD", env.MIN_LIQUIDITY_USD),
    MIN_HOLDERS: valueFor("MIN_HOLDERS", env.MIN_HOLDERS),
    MIN_VOLUME_USD: valueFor("MIN_VOLUME_USD", env.MIN_VOLUME_USD),
    MIN_VOLUME_5M_USD: valueFor("MIN_VOLUME_5M_USD", env.MIN_VOLUME_5M_USD),
    DIP_MIN_PCT: valueFor("DIP_MIN_PCT", env.DIP_MIN_PCT),
    DIP_MAX_PCT: valueFor("DIP_MAX_PCT", env.DIP_MAX_PCT),
    RECOVERY_MIN_PCT: valueFor("RECOVERY_MIN_PCT", env.RECOVERY_MIN_PCT),
    TREND_MAX_1H_PCT: valueFor("TREND_MAX_1H_PCT", env.TREND_MAX_1H_PCT),
    DISCOVERY_LIMIT: valueFor("DISCOVERY_LIMIT", env.DISCOVERY_LIMIT),
    AI_CANDIDATE_LIMIT: valueFor("AI_CANDIDATE_LIMIT", env.AI_CANDIDATE_LIMIT),
    AI_CANDIDATE_COOLDOWN_MS: valueFor("AI_CANDIDATE_COOLDOWN_MS", env.AI_CANDIDATE_COOLDOWN_MS),
    DISCOVERY_POLL_MS: valueFor("DISCOVERY_POLL_MS", env.DISCOVERY_POLL_MS),
    PRICE_SAMPLE_MS: valueFor("PRICE_SAMPLE_MS", env.PRICE_SAMPLE_MS),
    EVENT_POLL_MS: valueFor("EVENT_POLL_MS", env.EVENT_POLL_MS),
    POSITION_LOOP_MS: valueFor("POSITION_LOOP_MS", env.POSITION_LOOP_MS),
    AI_POSITION_REVIEW_MS: valueFor("AI_POSITION_REVIEW_MS", env.AI_POSITION_REVIEW_MS),
    AI_FAST_COOLDOWN_MS: valueFor("AI_FAST_COOLDOWN_MS", env.AI_FAST_COOLDOWN_MS),
    AI_FALLBACK_ENABLED: valueFor("AI_FALLBACK_ENABLED", env.AI_FALLBACK_ENABLED),
    AI_FALLBACK_MIN_SCORE: valueFor("AI_FALLBACK_MIN_SCORE", env.AI_FALLBACK_MIN_SCORE),
    AI_OVERRIDE_SCORE: valueFor("AI_OVERRIDE_SCORE", env.AI_OVERRIDE_SCORE),
    STALE_LOSS_EXIT_MINUTES: valueFor("STALE_LOSS_EXIT_MINUTES", env.STALE_LOSS_EXIT_MINUTES),
    STALE_LOSS_EXIT_PCT: valueFor("STALE_LOSS_EXIT_PCT", env.STALE_LOSS_EXIT_PCT),
    DEAD_MONEY_EXIT_MINUTES: valueFor("DEAD_MONEY_EXIT_MINUTES", env.DEAD_MONEY_EXIT_MINUTES),
    DEAD_MONEY_MAX_PNL_PCT: valueFor("DEAD_MONEY_MAX_PNL_PCT", env.DEAD_MONEY_MAX_PNL_PCT),
    DUST_POSITION_MON: valueFor("DUST_POSITION_MON", env.DUST_POSITION_MON),
    DAILY_MEAN_EXIT_PCT: valueFor("DAILY_MEAN_EXIT_PCT", env.DAILY_MEAN_EXIT_PCT),
    DAILY_MIN_SAMPLES: valueFor("DAILY_MIN_SAMPLES", env.DAILY_MIN_SAMPLES),
    FAST_CYCLE_MS: valueFor("FAST_CYCLE_MS", env.FAST_CYCLE_MS),
    PENDING_EXECUTION_TIMEOUT_MS: valueFor("PENDING_EXECUTION_TIMEOUT_MS", env.PENDING_EXECUTION_TIMEOUT_MS),
    LOW_CAP_MOMENTUM_ENABLED: valueFor("LOW_CAP_MOMENTUM_ENABLED", env.LOW_CAP_MOMENTUM_ENABLED),
    LOW_CAP_MIN_MARKET_CAP_USD: valueFor("LOW_CAP_MIN_MARKET_CAP_USD", env.LOW_CAP_MIN_MARKET_CAP_USD),
    LOW_CAP_MAX_MARKET_CAP_USD: valueFor("LOW_CAP_MAX_MARKET_CAP_USD", env.LOW_CAP_MAX_MARKET_CAP_USD),
    LOW_CAP_MIN_LIQUIDITY_USD: valueFor("LOW_CAP_MIN_LIQUIDITY_USD", env.LOW_CAP_MIN_LIQUIDITY_USD),
    LOW_CAP_MIN_HOLDERS: valueFor("LOW_CAP_MIN_HOLDERS", env.LOW_CAP_MIN_HOLDERS),
    LOW_CAP_MIN_VOLUME_USD: valueFor("LOW_CAP_MIN_VOLUME_USD", env.LOW_CAP_MIN_VOLUME_USD),
    LOW_CAP_MIN_AGE_MINUTES: valueFor("LOW_CAP_MIN_AGE_MINUTES", env.LOW_CAP_MIN_AGE_MINUTES),
    LOW_CAP_CANDIDATE_MAX_AGE_SECONDS: valueFor("LOW_CAP_CANDIDATE_MAX_AGE_SECONDS", env.LOW_CAP_CANDIDATE_MAX_AGE_SECONDS),
    LOW_CAP_MIN_BUY_SELL_RATIO_5M: valueFor("LOW_CAP_MIN_BUY_SELL_RATIO_5M", env.LOW_CAP_MIN_BUY_SELL_RATIO_5M),
    LOW_CAP_MIN_VOLUME_5M_USD: valueFor("LOW_CAP_MIN_VOLUME_5M_USD", env.LOW_CAP_MIN_VOLUME_5M_USD),
    LOW_CAP_MIN_VOLUME_ACCELERATION_5M: valueFor("LOW_CAP_MIN_VOLUME_ACCELERATION_5M", env.LOW_CAP_MIN_VOLUME_ACCELERATION_5M),
    LOW_CAP_MIN_TREND_1H_PCT: valueFor("LOW_CAP_MIN_TREND_1H_PCT", env.LOW_CAP_MIN_TREND_1H_PCT),
    LOW_CAP_MIN_SCORE: valueFor("LOW_CAP_MIN_SCORE", env.LOW_CAP_MIN_SCORE),
    LOW_CAP_LIQUIDITY_EXIT_RATIO: valueFor("LOW_CAP_LIQUIDITY_EXIT_RATIO", env.LOW_CAP_LIQUIDITY_EXIT_RATIO),
    LOW_CAP_SELL_PRESSURE_RATIO: valueFor("LOW_CAP_SELL_PRESSURE_RATIO", env.LOW_CAP_SELL_PRESSURE_RATIO),
    LOW_CAP_SELL_PRESSURE_MIN_VOLUME_USD: valueFor("LOW_CAP_SELL_PRESSURE_MIN_VOLUME_USD", env.LOW_CAP_SELL_PRESSURE_MIN_VOLUME_USD),
    LOW_CAP_TREND_EXIT_PCT: valueFor("LOW_CAP_TREND_EXIT_PCT", env.LOW_CAP_TREND_EXIT_PCT),
    LOW_CAP_LOSS_EXIT_PCT: valueFor("LOW_CAP_LOSS_EXIT_PCT", env.LOW_CAP_LOSS_EXIT_PCT),
    LOW_CAP_PEAK_DRAWDOWN_EXIT_PCT: valueFor("LOW_CAP_PEAK_DRAWDOWN_EXIT_PCT", env.LOW_CAP_PEAK_DRAWDOWN_EXIT_PCT),
    LOW_CAP_MAX_LIQUIDITY_POSITION_PCT: valueFor("LOW_CAP_MAX_LIQUIDITY_POSITION_PCT", env.LOW_CAP_MAX_LIQUIDITY_POSITION_PCT),
    LOW_CAP_FLOW_API_CANDIDATE_LIMIT: valueFor("LOW_CAP_FLOW_API_CANDIDATE_LIMIT", env.LOW_CAP_FLOW_API_CANDIDATE_LIMIT),
    FLOW_API_REFRESH_MS: valueFor("FLOW_API_REFRESH_MS", env.FLOW_API_REFRESH_MS),
    LEVERUP_ENABLED: valueFor("LEVERUP_ENABLED", env.LEVERUP_ENABLED),
    LEVERUP_DIAMOND: valueFor("LEVERUP_DIAMOND", env.LEVERUP_DIAMOND),
    LEVERUP_AGENT_PRIVATE_KEY: env.LEVERUP_AGENT_PRIVATE_KEY,
    LEVERUP_AGENT_PERMISSION_MASK: valueFor("LEVERUP_AGENT_PERMISSION_MASK", env.LEVERUP_AGENT_PERMISSION_MASK),
    LEVERUP_PYTH_HERMES_URL: valueFor("LEVERUP_PYTH_HERMES_URL", env.LEVERUP_PYTH_HERMES_URL),
    PYTH_API_KEY: env.PYTH_API_KEY,
    LEVERUP_DEFAULT_LEVERAGE: valueFor("LEVERUP_DEFAULT_LEVERAGE", env.LEVERUP_DEFAULT_LEVERAGE),
    LEVERUP_MAX_LEVERAGE: valueFor("LEVERUP_MAX_LEVERAGE", env.LEVERUP_MAX_LEVERAGE),
    LEVERUP_MIN_NOTIONAL_USD: valueFor("LEVERUP_MIN_NOTIONAL_USD", env.LEVERUP_MIN_NOTIONAL_USD),
    LEVERUP_MIN_MARGIN_USD: valueFor("LEVERUP_MIN_MARGIN_USD", env.LEVERUP_MIN_MARGIN_USD),
    LEVERUP_MAX_MARGIN_PCT: valueFor("LEVERUP_MAX_MARGIN_PCT", env.LEVERUP_MAX_MARGIN_PCT),
    LEVERUP_RISK_PER_TRADE_PCT: valueFor("LEVERUP_RISK_PER_TRADE_PCT", env.LEVERUP_RISK_PER_TRADE_PCT),
    LEVERUP_DAILY_LOSS_LIMIT_PCT: valueFor("LEVERUP_DAILY_LOSS_LIMIT_PCT", env.LEVERUP_DAILY_LOSS_LIMIT_PCT),
    LEVERUP_MAX_CONSECUTIVE_LOSSES: valueFor("LEVERUP_MAX_CONSECUTIVE_LOSSES", env.LEVERUP_MAX_CONSECUTIVE_LOSSES),
    LEVERUP_COOLDOWN_MS: valueFor("LEVERUP_COOLDOWN_MS", env.LEVERUP_COOLDOWN_MS),
    LEVERUP_AUTO_LIVE_AFTER_PAPER: valueFor("LEVERUP_AUTO_LIVE_AFTER_PAPER", env.LEVERUP_AUTO_LIVE_AFTER_PAPER)
  };

  for (const [key, value] of Object.entries(mapping)) {
    if (value !== undefined) process.env[key] = value;
  }
}

async function getRuntimeConfig(env: Env) {
  hydrateProcessEnv(env);
  return (await import("./src/config.js")).config;
}

export { GeldHighCapLearning, GeldLeverUpPaper };

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
  private cycleInFlight = false;
  private learningLastSampleAt = 0;
  private learningSummaryCache: any = null;
  private learningSummaryAt = 0;
  private leverUpReadinessAt = 0;
  private leverUpReadiness: any = null;
  private lastFullCycleAttemptAt = 0;
  private lastLeverUpPaperAt = 0;

  private async getEngine() {
    if (this.engine) return this.engine;

    hydrateProcessEnv(this.env);
    const { TradingEngine } = await import("./src/engine.js");

    const learning = this.env.GELD_HIGHCAP_LEARNING.get(this.env.GELD_HIGHCAP_LEARNING.idFromName("highcap-main"));
    this.engine = new TradingEngine({
      highCapLearning: {
        getSummary: async () => {
        if (this.learningSummaryCache && Date.now() - this.learningSummaryAt < 15 * 60_000) return this.learningSummaryCache;
        try {
          const response = await learning.fetch(new Request("https://learning/summary"));
          if (response.ok) {
            this.learningSummaryCache = await response.json();
            this.learningSummaryAt = Date.now();
          }
        } catch {}
        return this.learningSummaryCache;
        }
      }
    });
    await this.engine.init();
    return this.engine;
  }

  private async sampleHighCaps(engine:any) {
    const now=Date.now();
    if(now-this.learningLastSampleAt < 5*60_000) return;
    this.learningLastSampleAt=now;
    const state=engine.snapshot();
    const samples=Object.values(state.tokens)
      .filter((t:any)=>(t.marketCapUsd??0)>=250000 && (t.priceMon??0)>0)
      .sort((a:any,b:any)=>(b.localScore??0)-(a.localScore??0))
      .slice(0,30)
      .map((t:any)=>({
        ts:now, token:t.token, symbol:t.symbol, marketCapUsd:t.marketCapUsd??0,
        liquidityUsd:t.liquidityUsd??0,
        volume5mUsd:t.apiVolume5mUsd??((t.volume5mMon??0)*(t.monUsdPrice??0)),
        buySellRatio5m:t.buySellRatio5m??0, buyMakers5m:t.apiBuyMakers5m??0,
        trend1hPct:t.trendPct1h??0, trend4hPct:t.trendPct4h??0, priceMon:t.priceMon??0,
        dayHighPriceMon:t.dayHighPriceMon??0, dayLowPriceMon:t.dayLowPriceMon??0,
        dayAvgPriceMon:t.dayAvgPriceMon??0, strategy:t.entryStrategy, localScore:t.localScore??0
      }));
    if(!samples.length) return;
    try {
      await this.env.GELD_HIGHCAP_LEARNING.get(this.env.GELD_HIGHCAP_LEARNING.idFromName("highcap-main"))
        .fetch(new Request("https://learning/observe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({samples})}));
    } catch {}
  }

  private async runLeverUpPaper() {
    const runtime = await getRuntimeConfig(this.env);
    if (!runtime.leverUpEnabled) return;
    const paper = this.env.GELD_LEVERUP_PAPER.get(this.env.GELD_LEVERUP_PAPER.idFromName("leverup-main"));
    try {
      const { getLeverUpMarketSnapshots, openLeverUpMonTrade, probeLeverUpMinimums } = await import("./src/leverup.js");
      const snapshots = await getLeverUpMarketSnapshots();
      const tickResponse = await paper.fetch(new Request("https://leverup/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshots })
      }));
      const tick = await tickResponse.json() as any;
      if (tick.mode !== "LIVE" || !runtime.leverUpAutoLiveAfterPaper || !runtime.liveTrading) return;

      if (!this.leverUpReadiness || Date.now() - this.leverUpReadinessAt >= 10 * 60_000) {
        try {
          const probe = await probeLeverUpMinimums("MON/USD", 5);
          this.leverUpReadiness = {
            checkedAt: Date.now(),
            ok: Boolean(probe.firstReady),
            firstAcceptedMarginMon: probe.firstReady?.marginMon ?? null,
            balanceMon: probe.balanceMon,
            maxAllowedMarginMon: probe.maxAllowedMarginMon,
            results: probe.results
          };
          this.leverUpReadinessAt = Date.now();
          await paper.fetch(new Request("https://leverup/readiness", {
            method:"POST", headers:{"content-type":"application/json"},
            body:JSON.stringify({ok:this.leverUpReadiness.ok,firstAcceptedMarginMon:this.leverUpReadiness.firstAcceptedMarginMon,detail:this.leverUpReadiness})
          }));
        } catch (error) {
          this.leverUpReadiness = {checkedAt:Date.now(),ok:false,error:String(error)};
          this.leverUpReadinessAt = Date.now();
          await paper.fetch(new Request("https://leverup/readiness", {
            method:"POST", headers:{"content-type":"application/json"},
            body:JSON.stringify({ok:false,detail:this.leverUpReadiness})
          }));
          return;
        }
      }
      if (!this.leverUpReadiness?.ok) return;

      const signal = tick.signals?.[0];
      if (!signal) return;
      const minMargin = Number(this.leverUpReadiness.firstAcceptedMarginMon ?? 0);
      const maxMargin = Number(this.leverUpReadiness.maxAllowedMarginMon ?? 0);
      const marginMon = Math.min(maxMargin, Math.max(minMargin, Number(signal.marginMon)));
      if (!(marginMon > 0)) return;

      const opened = await openLeverUpMonTrade(
        signal.symbol, marginMon, Number(signal.leverage),
        signal.side === "LONG", Number(signal.stop), Number(signal.take)
      );
      await paper.fetch(new Request("https://leverup/live-opened", {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({symbol:signal.symbol,txHash:opened.txHash,intentHash:opened.intentHash})
      }));
    } catch (error) {
      console.error("LeverUp paper/live tick failed:", error);
    }
  }

  private async runRiskCycle() {
    if (this.cycleInFlight) return;
    this.cycleInFlight = true;
    try {
      const engine = await this.getEngine();
      if (engine.snapshot().running) {
        await engine.runRiskCycle();

        // LeverUp market polling is useful, but running it every 10s adds a
        // burst of REST/RPC requests to the same Worker invocation budget.
        // Keep position/risk management fast and sample LeverUp at most once
        // per minute.
        const now = Date.now();
        if (now - this.lastLeverUpPaperAt >= 60_000) {
          this.lastLeverUpPaperAt = now;
          await this.runLeverUpPaper();
        }

        await this.sampleHighCaps(engine);
      }
    } finally {
      this.cycleInFlight = false;
      if (this.engine?.snapshot()?.running) {
        await this.ctx.storage.setAlarm(Date.now() + (await getRuntimeConfig(this.env)).fastCycleMs);
      }
    }
  }

  private async runFullCycle() {
    if (this.cycleInFlight) return;
    this.cycleInFlight = true;
    this.lastFullCycleAttemptAt = Date.now();
    try {
      const engine = await this.getEngine();
      if (engine.snapshot().running) {
        await engine.runScheduledCycle();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("GELD full cycle failed:", error);
      if (this.engine) {
        this.engine.store.update((s: any) => {
          s.stats.lastScheduledError = "WORKER: " + message;
          s.stats.lastScheduledPhaseErrorAt = Date.now();
          s.stats.lastError = message;
        });
        try { await this.engine.store.save(); } catch {}
      }
    } finally {
      this.cycleInFlight = false;
    }
  }

  async alarm() {
    const engine = await this.getEngine();
    if (!engine.snapshot().running) return;

    const now = Date.now();
    const lastFullCycle = engine.snapshot().stats.lastCycleAt ?? 0;
    // The 1-minute cron remains a second trigger, but the Durable Object alarm
    // is the reliable heartbeat. If the cron trigger is delayed/missed, the
    // alarm promotes itself to a full market/discovery cycle.
    const fullCycleDue =
      now - Math.max(lastFullCycle, this.lastFullCycleAttemptAt) >= 55_000;

    if (fullCycleDue) await this.runFullCycle();
    else await this.runRiskCycle();
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
        const now = Date.now();
        const lastFullCycle = engine.snapshot().stats.lastCycleAt ?? 0;
        if (now - Math.max(lastFullCycle, this.lastFullCycleAttemptAt) >= 55_000) {
          await this.runFullCycle();
        } else {
          // Cron is a secondary heartbeat. Keep it cheap when the DO alarm has
          // already completed a recent full cycle.
          await this.runRiskCycle();
        }
      }

      await this.ctx.storage.setAlarm(Date.now() + (await getRuntimeConfig(this.env)).fastCycleMs);
      return Response.json(engine.snapshot());
    }

    if (!isPublicApiRead(request) && !isAuthorized(request, this.env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const engine = await this.getEngine();

    if (path === "/api/health" || path === "/api/state") {
      const state = engine.snapshot();
      const runtimeConfig = await getRuntimeConfig(this.env);

      if (path === "/api/health") {
        return Response.json({
          ok: true,
          running: state.running,
          liveTrading: state.liveTrading,
          walletAddress: state.walletAddress,
          balanceMon: state.balanceMon,
          openPositions: Object.values(state.positions).filter((p: any) => p.status === "OPEN").length,
          chainId: 143,
          lastCycleAt: state.stats.lastCycleAt ?? 0,
          lastScheduledAttemptAt: state.stats.lastScheduledAttemptAt ?? 0,
          lastScheduledPhase: state.stats.lastScheduledPhase ?? null,
          lastScheduledPhaseAt: state.stats.lastScheduledPhaseAt ?? 0,
          lastScheduledPhaseErrorAt: state.stats.lastScheduledPhaseErrorAt ?? 0,
          lastScheduledDurationMs: state.stats.lastScheduledDurationMs ?? 0,
          lastScheduledError: state.stats.lastScheduledError ?? null,
          minLiquidityUsd: runtimeConfig.minLiquidityUsd,
          minMarketCapUsd: runtimeConfig.minMarketCapUsd
        });
      }

      return Response.json({
        ...state,
        effectiveConfig: {
          network: runtimeConfig.network,
          chainId: runtimeConfig.chainId,
          liveTrading: runtimeConfig.liveTrading,
          autoStart: runtimeConfig.autoStart,
          minLiquidityUsd: runtimeConfig.minLiquidityUsd,
          minMarketCapUsd: runtimeConfig.minMarketCapUsd,
          minEstablishedAgeMinutes: runtimeConfig.minEstablishedAgeMinutes,
          minHolders: runtimeConfig.minHolders,
          minVolumeUsd: runtimeConfig.minVolumeUsd,
          dipMinPct: runtimeConfig.dipMinPct,
          dipMaxPct: runtimeConfig.dipMaxPct,
          trendMax1hPct: runtimeConfig.trendMax1hPct,
          minTrend4hPct: runtimeConfig.minTrend4hPct,
          fastCycleMs: runtimeConfig.fastCycleMs,
          sellGasLimit: runtimeConfig.sellGasLimit,
          sellGasPaddingPct: runtimeConfig.sellGasPaddingPct,
          sellFailureCooldownMs: runtimeConfig.sellFailureCooldownMs,
          sellFailureQuarantineMs: runtimeConfig.sellFailureQuarantineMs,
          sellFailureQuarantineCount: runtimeConfig.sellFailureQuarantineCount,
          aiMaxCallsPerCycle: runtimeConfig.aiMaxCallsPerCycle,
          aiMaxCallsPerDay: runtimeConfig.aiMaxCallsPerDay,
          aiMaxAttemptsPerDecision: runtimeConfig.aiMaxAttemptsPerDecision,
          reentryCooldownMs: runtimeConfig.reentryCooldownMs,
          highCapMinMarketCapUsd: runtimeConfig.highCapMinMarketCapUsd,
          highCapMinVolume5mUsd: runtimeConfig.highCapMinVolume5mUsd,
          highCapMinBuySellRatio5m: runtimeConfig.highCapMinBuySellRatio5m,
          highCapMinBuyMakers5m: runtimeConfig.highCapMinBuyMakers5m,
          highCapMinTrend4hPct: runtimeConfig.highCapMinTrend4hPct,
          lowCapMomentumEnabled: runtimeConfig.lowCapMomentumEnabled,
          lowCapMinMarketCapUsd: runtimeConfig.lowCapMinMarketCapUsd,
          lowCapMaxMarketCapUsd: runtimeConfig.lowCapMaxMarketCapUsd,
          lowCapMinLiquidityUsd: runtimeConfig.lowCapMinLiquidityUsd,
          lowCapMinHolders: runtimeConfig.lowCapMinHolders,
          lowCapMinVolumeUsd: runtimeConfig.lowCapMinVolumeUsd,
          lowCapMinAgeMinutes: runtimeConfig.lowCapMinAgeMinutes,
          lowCapMinBuySellRatio5m: runtimeConfig.lowCapMinBuySellRatio5m,
          lowCapMinVolume5mUsd: runtimeConfig.lowCapMinVolume5mUsd,
          lowCapMinVolumeAcceleration5m: runtimeConfig.lowCapMinVolumeAcceleration5m,
          lowCapMinTrend1hPct: runtimeConfig.lowCapMinTrend1hPct,
          lowCapMinScore: runtimeConfig.lowCapMinScore,
          lowCapLiquidityExitRatio: runtimeConfig.lowCapLiquidityExitRatio,
          lowCapSellPressureRatio: runtimeConfig.lowCapSellPressureRatio,
          lowCapTrendExitPct: runtimeConfig.lowCapTrendExitPct,
          lowCapLossExitPct: runtimeConfig.lowCapLossExitPct,
          lowCapPeakDrawdownExitPct: runtimeConfig.lowCapPeakDrawdownExitPct,
          earlyLaunchEnabled: runtimeConfig.earlyLaunchEnabled,
          earlyLaunchMinAgeSeconds: runtimeConfig.earlyLaunchMinAgeSeconds,
          earlyLaunchMaxAgeMinutes: runtimeConfig.earlyLaunchMaxAgeMinutes,
          earlyLaunchMinMarketCapUsd: runtimeConfig.earlyLaunchMinMarketCapUsd,
          earlyLaunchMaxMarketCapUsd: runtimeConfig.earlyLaunchMaxMarketCapUsd,
          earlyLaunchMinLiquidityUsd: runtimeConfig.earlyLaunchMinLiquidityUsd,
          earlyLaunchMinHolders: runtimeConfig.earlyLaunchMinHolders,
          earlyLaunchMinVolume1mUsd: runtimeConfig.earlyLaunchMinVolume1mUsd,
          earlyLaunchMinBuySell1m: runtimeConfig.earlyLaunchMinBuySell1m,
          earlyLaunchMinUniqueBuyers1m: runtimeConfig.earlyLaunchMinUniqueBuyers1m,
          earlyLaunchMaxTopBuyerShare1m: runtimeConfig.earlyLaunchMaxTopBuyerShare1m,
          earlyLaunchMinTrend1mPct: runtimeConfig.earlyLaunchMinTrend1mPct,
          earlyLaunchMaxTrend1mPct: runtimeConfig.earlyLaunchMaxTrend1mPct,
          earlyLaunchProbePortfolioPct: runtimeConfig.earlyLaunchProbePortfolioPct,
          newEventPollMs: runtimeConfig.newEventPollMs
        }
      });
    }

    if (path === "/api/config") {
      const runtimeConfig = await getRuntimeConfig(this.env);
      return Response.json({
        network: runtimeConfig.network,
        chainId: runtimeConfig.chainId,
        liveTrading: runtimeConfig.liveTrading,
        autoStart: runtimeConfig.autoStart,
        minLiquidityUsd: runtimeConfig.minLiquidityUsd,
        minMarketCapUsd: runtimeConfig.minMarketCapUsd,
        minEstablishedAgeMinutes: runtimeConfig.minEstablishedAgeMinutes,
        minHolders: runtimeConfig.minHolders,
        minVolumeUsd: runtimeConfig.minVolumeUsd,
        dipMinPct: runtimeConfig.dipMinPct,
        dipMaxPct: runtimeConfig.dipMaxPct,
        recoveryMinPct: runtimeConfig.recoveryMinPct,
        dipMinReboundPct: runtimeConfig.dipMinReboundPct,
        dipMinBuySellRatio5m: runtimeConfig.dipMinBuySellRatio5m,
        dipMinVolume5mUsd: runtimeConfig.dipMinVolume5mUsd,
        dipMaxTrend1hPct: runtimeConfig.dipMaxTrend1hPct,
        trendMax1hPct: runtimeConfig.trendMax1hPct,
        minTrend4hPct: runtimeConfig.minTrend4hPct,
        fastCycleMs: runtimeConfig.fastCycleMs,
        sellGasLimit: runtimeConfig.sellGasLimit,
        sellGasPaddingPct: runtimeConfig.sellGasPaddingPct,
        sellFailureCooldownMs: runtimeConfig.sellFailureCooldownMs,
        sellFailureQuarantineMs: runtimeConfig.sellFailureQuarantineMs,
        sellFailureQuarantineCount: runtimeConfig.sellFailureQuarantineCount,
        aiMaxCallsPerCycle: runtimeConfig.aiMaxCallsPerCycle,
        aiMaxAttemptsPerDecision: runtimeConfig.aiMaxAttemptsPerDecision,
        reentryCooldownMs: runtimeConfig.reentryCooldownMs,
        highCapMinMarketCapUsd: runtimeConfig.highCapMinMarketCapUsd,
        highCapMinVolume5mUsd: runtimeConfig.highCapMinVolume5mUsd,
        highCapMinBuySellRatio5m: runtimeConfig.highCapMinBuySellRatio5m,
        highCapMinBuyMakers5m: runtimeConfig.highCapMinBuyMakers5m,
        highCapMinTrend4hPct: runtimeConfig.highCapMinTrend4hPct,
        lowCapMomentumEnabled: runtimeConfig.lowCapMomentumEnabled,
        lowCapMinMarketCapUsd: runtimeConfig.lowCapMinMarketCapUsd,
        lowCapMaxMarketCapUsd: runtimeConfig.lowCapMaxMarketCapUsd,
        lowCapMinLiquidityUsd: runtimeConfig.lowCapMinLiquidityUsd,
        lowCapMinHolders: runtimeConfig.lowCapMinHolders,
        lowCapMinVolumeUsd: runtimeConfig.lowCapMinVolumeUsd,
        lowCapMinAgeMinutes: runtimeConfig.lowCapMinAgeMinutes,
        lowCapMinBuySellRatio5m: runtimeConfig.lowCapMinBuySellRatio5m,
        lowCapMinVolume5mUsd: runtimeConfig.lowCapMinVolume5mUsd,
        lowCapMinVolumeAcceleration5m: runtimeConfig.lowCapMinVolumeAcceleration5m,
        lowCapMinTrend1hPct: runtimeConfig.lowCapMinTrend1hPct,
        lowCapMinScore: runtimeConfig.lowCapMinScore,
        lowCapLiquidityExitRatio: runtimeConfig.lowCapLiquidityExitRatio,
        lowCapSellPressureRatio: runtimeConfig.lowCapSellPressureRatio,
        lowCapTrendExitPct: runtimeConfig.lowCapTrendExitPct,
        lowCapLossExitPct: runtimeConfig.lowCapLossExitPct,
        lowCapPeakDrawdownExitPct: runtimeConfig.lowCapPeakDrawdownExitPct,
        earlyLaunchEnabled: runtimeConfig.earlyLaunchEnabled,
        earlyLaunchMinAgeSeconds: runtimeConfig.earlyLaunchMinAgeSeconds,
        earlyLaunchMaxAgeMinutes: runtimeConfig.earlyLaunchMaxAgeMinutes,
        earlyLaunchMinMarketCapUsd: runtimeConfig.earlyLaunchMinMarketCapUsd,
        earlyLaunchMaxMarketCapUsd: runtimeConfig.earlyLaunchMaxMarketCapUsd,
        earlyLaunchMinLiquidityUsd: runtimeConfig.earlyLaunchMinLiquidityUsd,
        earlyLaunchMinHolders: runtimeConfig.earlyLaunchMinHolders,
        earlyLaunchMinVolume1mUsd: runtimeConfig.earlyLaunchMinVolume1mUsd,
        earlyLaunchMinBuySell1m: runtimeConfig.earlyLaunchMinBuySell1m,
        earlyLaunchMinUniqueBuyers1m: runtimeConfig.earlyLaunchMinUniqueBuyers1m,
        earlyLaunchMaxTopBuyerShare1m: runtimeConfig.earlyLaunchMaxTopBuyerShare1m,
        earlyLaunchMinTrend1mPct: runtimeConfig.earlyLaunchMinTrend1mPct,
        earlyLaunchMaxTrend1mPct: runtimeConfig.earlyLaunchMaxTrend1mPct,
        earlyLaunchMinScore: runtimeConfig.earlyLaunchMinScore,
        earlyLaunchProbePortfolioPct: runtimeConfig.earlyLaunchProbePortfolioPct,
        newEventPollMs: runtimeConfig.newEventPollMs,
        newEventCandidateLimit: runtimeConfig.newEventCandidateLimit
      });
    }

    if (path === "/api/lst/arbitrage") {
      try {
        const result = await scanLSTArbitrage();
        return Response.json(result, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({
          mode: "PAPER_SIGNAL_ONLY",
          error: error instanceof Error ? error.message : String(error),
          generatedAt: new Date().toISOString()
        }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }

    if (path === "/api/leverup/paper") {
      const paper = this.env.GELD_LEVERUP_PAPER.get(this.env.GELD_LEVERUP_PAPER.idFromName("leverup-main"));
      return paper.fetch(new Request("https://leverup/status"));
    }

    if (path === "/api/leverup/preflight") {
      try {
        const { probeLeverUpMinimums } = await import("./src/leverup.js");
        const orderType = (url.searchParams.get("orderType") ?? "limit").toLowerCase();
        const action = orderType === "limit" ? 2 : 0;
        return Response.json(await probeLeverUpMinimums(url.searchParams.get("symbol") ?? "BTC/USD", Number(url.searchParams.get("leverage") ?? 5), action));
      } catch (error) { return Response.json({ ok: false, error: String(error) }, { status: 503 }); }
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
      await this.ctx.storage.setAlarm(Date.now() + (await getRuntimeConfig(this.env)).fastCycleMs);
      return Response.json({ ok: true, state: engine.snapshot() });
    }

    if (request.method === "POST" && path === "/api/stop") {
      await engine.stop();
      await this.ctx.storage.deleteAlarm();
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

    if (request.method === "OPTIONS" && request.url.includes("/api/")) {
      return withCors(new Response(null, { status: 204 }), request);
    }

    const publicRead = isPublicApiRead(request);
    if (!publicRead && !isAuthorized(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const id = env.GELD_BOT.idFromName("singleton");
    const response = await env.GELD_BOT.get(id).fetch(request);
    return publicRead ? withCors(response, request) : response;
  },

  async scheduled(_event: ScheduledEvent, env: Env) {
    const id = env.GELD_BOT.idFromName("singleton");
    await env.GELD_BOT.get(id).fetch(
      new Request("https://geld.internal/__cron", { method: "POST" })
    );
  }
};
