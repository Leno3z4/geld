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
  minLocalScore: num("MIN_LOCAL_SCORE", 35),
  aiMinConfidence: num("AI_MIN_CONFIDENCE", 0.45),
  slippagePct: num("SLIPPAGE_PCT", 6),
  sellGasLimit: Math.max(250000, Math.floor(num("SELL_GAS_LIMIT", 1_000_000))),
  hardStopPct: num("HARD_STOP_LOSS_PCT", 18),
  takeProfitPct: num("TAKE_PROFIT_PCT", 55),
  trailingPct: num("TRAILING_STOP_PCT", 15),
  maxHoldMinutes: num("MAX_HOLD_MINUTES", 180),

  // Aggressive profit-taking / loss-cutting for established tokens.
  // Take a small first profit instead of waiting for a large move.
  profitTake1Pct: num("PROFIT_TAKE_1_PCT", 3),
  profitTake1SellPct: num("PROFIT_TAKE_1_SELL_PCT", 25),
  profitTake2Pct: num("PROFIT_TAKE_2_PCT", 30),
  profitTake2SellPct: num("PROFIT_TAKE_2_SELL_PCT", 33),
  profitTake3Pct: num("PROFIT_TAKE_3_PCT", 50),
  profitTake3SellPct: num("PROFIT_TAKE_3_SELL_PCT", 50),
  profitProtectionStartPct: num("PROFIT_PROTECTION_START_PCT", 12),
  profitProtectionFloorPct: num("PROFIT_PROTECTION_FLOOR_PCT", 5),
  profitProtectionRatio: num("PROFIT_PROTECTION_RATIO", 0.40),
  earlyExitLossPct: num("EARLY_EXIT_LOSS_PCT", -10),
  earlyExitTrend1hPct: num("EARLY_EXIT_TREND_1H_PCT", -8),
  momentumExitProfitPct: num("MOMENTUM_EXIT_PROFIT_PCT", 8),
  momentumExitTrend1hPct: num("MOMENTUM_EXIT_TREND_1H_PCT", -10),
  momentumExitReboundPct: num("MOMENTUM_EXIT_REBOUND_1H_PCT", 2),
  sellPressureExitRatio: num("SELL_PRESSURE_EXIT_RATIO", 0.65),
  sellPressureMinVolumeMon: num("SELL_PRESSURE_MIN_VOLUME_5M_MON", 20),
  minTrend4hPct: num("MIN_TREND_4H_PCT", -12),
  liquidityExitRatio: num("LIQUIDITY_EXIT_RATIO", 0.65),
  maxQuoteFailures: Math.max(1, Math.floor(num("MAX_QUOTE_FAILURES", 3))),

  eventPollMs: num("EVENT_POLL_MS", 800),
  positionLoopMs: num("POSITION_LOOP_MS", 2200),
  aiPositionReviewMs: num("AI_POSITION_REVIEW_MS", 30000),
  aiFastCooldownMs: num("AI_FAST_COOLDOWN_MS", 4000),
  aiFallbackEnabled: bool("AI_FALLBACK_ENABLED", true),
  aiFallbackMinScore: num("AI_FALLBACK_MIN_SCORE", 55),
  candidateMaxAgeSeconds: num("CANDIDATE_MAX_AGE_SECONDS", 180),
  eventBackfillBlocks: Math.max(0, Math.floor(num("EVENT_BACKFILL_BLOCKS", 1000))),
  // Monad currently rejects eth_getLogs ranges wider than 100 blocks.
  logChunkBlocks: Math.max(1, Math.min(100, Math.floor(num("LOG_CHUNK_BLOCKS", 100)))),
  maxLogChunksPerCycle: Math.max(1, Math.floor(num("MAX_LOG_CHUNKS_PER_CYCLE", 4))),

  // Established-token dip strategy: do not buy newly launched tokens.
  establishedOnly: true,
  minEstablishedAgeMinutes: Math.max(5, num("MIN_ESTABLISHED_AGE_MINUTES", 10)),
  minLiquidityUsd: Math.max(0, num("MIN_LIQUIDITY_USD", 2500)),
  minMarketCapUsd: Math.max(0, num("MIN_MARKET_CAP_USD", 25000)),
  minHolders: Math.max(0, Math.floor(num("MIN_HOLDERS", 10))),
  minVolumeMon: Math.max(0, num("MIN_VOLUME_MON", 25)),
  dipMinPct: Math.max(0, num("DIP_MIN_PCT", 3)),
  dipMaxPct: Math.max(1, num("DIP_MAX_PCT", 50)),
  recoveryMinPct: num("RECOVERY_MIN_PCT", -10),
  trendMax1hPct: num("TREND_MAX_1H_PCT", 20),
  discoveryLimit: Math.max(10, Math.min(50, Math.floor(num("DISCOVERY_LIMIT", 50)))),
  aiCandidateLimit: Math.max(1, Math.min(15, Math.floor(num("AI_CANDIDATE_LIMIT", 8)))),
  discoveryPollMs: Math.max(30000, num("DISCOVERY_POLL_MS", 60000)),
  priceSampleMs: Math.max(60000, num("PRICE_SAMPLE_MS", 300000)),

  nadfunApiUrl: process.env.NADFUN_API_URL ?? "https://api.nadapp.net",
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
