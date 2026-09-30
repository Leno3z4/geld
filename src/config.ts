import "dotenv/config";

function bool(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function num(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function csv(name: string) {
  return (process.env[name] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

export const config = {
  network: "mainnet" as const,
  chainId: 143,
  rpcUrl: process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz",
  wsUrl: process.env.MONAD_WS_URL ?? "",
  privateKey: process.env.MONAD_PRIVATE_KEY ?? "",
  liveTrading: bool("LIVE_TRADING", false),
  autoStart: bool("AUTO_START", false),

  // High-aggression defaults; override them in Cloudflare Worker vars if needed.
  startingCapitalMon: num("STARTING_CAPITAL_MON", 38),
  positionSizePct: num("POSITION_SIZE_PCT", 24),
  maxTotalExposurePct: num("MAX_TOTAL_EXPOSURE_PCT", 90),
  maxOpenPositions: Math.max(1, Math.floor(num("MAX_OPEN_POSITIONS", 5))),
  gasReserveMon: num("GAS_RESERVE_MON", 0.75),
  minLocalScore: num("MIN_LOCAL_SCORE", 50),
  aiMinConfidence: num("AI_MIN_CONFIDENCE", 0.58),
  slippagePct: num("SLIPPAGE_PCT", 6),
  hardStopPct: num("HARD_STOP_LOSS_PCT", 30),
  takeProfitPct: num("TAKE_PROFIT_PCT", 70),
  trailingPct: num("TRAILING_STOP_PCT", 20),
  maxHoldMinutes: num("MAX_HOLD_MINUTES", 240),

  eventPollMs: num("EVENT_POLL_MS", 800),
  positionLoopMs: num("POSITION_LOOP_MS", 2200),
  aiPositionReviewMs: num("AI_POSITION_REVIEW_MS", 30000),
  aiFastCooldownMs: num("AI_FAST_COOLDOWN_MS", 4000),
  candidateMaxAgeSeconds: num("CANDIDATE_MAX_AGE_SECONDS", 180),

  nadfunApiUrl: "https://api.nad.fun",
  nadfunApiKey: process.env.NADFUN_API_KEY ?? "",

  geminiKeys: csv("GEMINI_API_KEYS"),
  geminiFastModel: process.env.GEMINI_FAST_MODEL ?? "gemini-3.1-flash-lite",
  geminiEscalationModel: process.env.GEMINI_ESCALATION_MODEL ?? "gemini-3.8-flash",

  stateSyncUrl: process.env.STATE_SYNC_URL ?? "",
  stateSyncSecret: process.env.STATE_SYNC_SECRET ?? "",
  stateFile: process.env.STATE_FILE ?? "./data/state.json",
  port: Math.floor(num("BOT_PORT", 8787))
};

export function assertLiveConfig() {
  if (!config.liveTrading) return;

  if (!config.privateKey || !config.privateKey.startsWith("0x") || config.privateKey.length !== 66) {
    throw new Error("LIVE_TRADING=true requires a 32-byte hex MONAD_PRIVATE_KEY");
  }

  if (config.geminiKeys.length === 0) {
    throw new Error("LIVE_TRADING=true requires at least one GEMINI_API_KEYS value");
  }
}
