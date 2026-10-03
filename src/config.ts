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

function bigint(name: string, fallback: bigint) {
  const value = (process.env[name] ?? "").trim();
  if (!value) return fallback;
  if (value.toUpperCase() === "ALL") return (2n ** 256n) - 1n;
  try { return BigInt(value); } catch { return fallback; }
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
  pendingExecutionTimeoutMs: Math.max(60_000, num("PENDING_EXECUTION_TIMEOUT_MS", 5 * 60 * 1000)),
  gasReserveMon: num("GAS_RESERVE_MON", 0.75),
  dailyLossLimitPct: Math.max(1, num("DAILY_LOSS_LIMIT_PCT", 5)),
  earlyLaunchEnabled: bool("EARLY_LAUNCH_ENABLED", true),
  earlyLaunchMinAgeSeconds: Math.max(20, num("EARLY_LAUNCH_MIN_AGE_SECONDS", 45)),
  earlyLaunchMaxAgeMinutes: Math.max(1, num("EARLY_LAUNCH_MAX_AGE_MINUTES", 6)),
  earlyLaunchMinMarketCapUsd: Math.max(1000, num("EARLY_LAUNCH_MIN_MARKET_CAP_USD", 5000)),
  earlyLaunchMaxMarketCapUsd: Math.max(1000, num("EARLY_LAUNCH_MAX_MARKET_CAP_USD", 20000)),
  earlyLaunchMinLiquidityUsd: Math.max(500, num("EARLY_LAUNCH_MIN_LIQUIDITY_USD", 1500)),
  earlyLaunchMinHolders: Math.max(2, Math.floor(num("EARLY_LAUNCH_MIN_HOLDERS", 4))),
  earlyLaunchMinVolume1mUsd: Math.max(0, num("EARLY_LAUNCH_MIN_VOLUME_1M_USD", 150)),
  earlyLaunchMinBuySell1m: Math.max(1, num("EARLY_LAUNCH_MIN_BUY_SELL_1M", 1.75)),
  earlyLaunchMinUniqueBuyers1m: Math.max(2, Math.floor(num("EARLY_LAUNCH_MIN_UNIQUE_BUYERS_1M", 3))),
  earlyLaunchMaxTopBuyerShare1m: Math.min(1, Math.max(0.1, num("EARLY_LAUNCH_MAX_TOP_BUYER_SHARE_1M", 0.60))),
  earlyLaunchMinTrend1mPct: num("EARLY_LAUNCH_MIN_TREND_1M_PCT", 3),
  earlyLaunchMinCurveVelocityPctPerMin: Math.max(0.25, num("EARLY_LAUNCH_MIN_CURVE_VELOCITY_PCT_PER_MIN", 2)),
  earlyLaunchMaxTrend1mPct: Math.max(5, num("EARLY_LAUNCH_MAX_TREND_1M_PCT", 50)),
  earlyLaunchMinScore: Math.max(0, num("EARLY_LAUNCH_MIN_SCORE", 30)),
  earlyLaunchProbePortfolioPct: Math.min(5, Math.max(0.25, num("EARLY_LAUNCH_PROBE_PORTFOLIO_PCT", 2))),
  newEventPollMs: Math.max(5000, num("NEW_EVENT_POLL_MS", 10000)),
  newEventCandidateLimit: Math.max(1, Math.min(3, Math.floor(num("NEW_EVENT_CANDIDATE_LIMIT", 2)))),
  minLocalScore: num("MIN_LOCAL_SCORE", 35),
  aiMinConfidence: num("AI_MIN_CONFIDENCE", 0.45),
  slippagePct: num("SLIPPAGE_PCT", 6),
  sellGasLimit: Math.max(500000, Math.floor(num("SELL_GAS_LIMIT", 1_500_000))),
  sellGasPaddingPct: Math.max(5, Math.min(50, num("SELL_GAS_PADDING_PCT", 20))),
  sellFailureCooldownMs: Math.max(60_000, num("SELL_FAILURE_COOLDOWN_MS", 15 * 60 * 1000)),
  sellFailureQuarantineMs: Math.max(30 * 60 * 1000, num("SELL_FAILURE_QUARANTINE_MS", 60 * 60 * 1000)),
  sellFailureQuarantineCount: Math.max(2, Math.floor(num("SELL_FAILURE_QUARANTINE_COUNT", 3))),
  hardStopPct: num("HARD_STOP_LOSS_PCT", 10),
  takeProfitPct: num("TAKE_PROFIT_PCT", 20),
  trailingPct: num("TRAILING_STOP_PCT", 8),
  maxHoldMinutes: num("MAX_HOLD_MINUTES", 180),
  staleLossExitMinutes: num("STALE_LOSS_EXIT_MINUTES", 45),
  staleLossExitPct: num("STALE_LOSS_EXIT_PCT", -4),
  deadMoneyExitMinutes: num("DEAD_MONEY_EXIT_MINUTES", 90),
  deadMoneyMaxPnlPct: num("DEAD_MONEY_MAX_PNL_PCT", 3),
  dustPositionMon: num("DUST_POSITION_MON", 0.05),
  dailyMeanExitPct: num("DAILY_MEAN_EXIT_PCT", 1.5),
  dailyMinSamples: Math.max(6, Math.floor(num("DAILY_MIN_SAMPLES", 24))),

  // Aggressive profit-taking / loss-cutting for established tokens.
  // Take a small first profit instead of waiting for a large move.
  profitTake1Pct: num("PROFIT_TAKE_1_PCT", 6),
  profitTake1SellPct: num("PROFIT_TAKE_1_SELL_PCT", 50),
  profitTake2Pct: num("PROFIT_TAKE_2_PCT", 12),
  profitTake2SellPct: num("PROFIT_TAKE_2_SELL_PCT", 50),
  profitTake3Pct: num("PROFIT_TAKE_3_PCT", 20),
  profitTake3SellPct: num("PROFIT_TAKE_3_SELL_PCT", 100),
  profitProtectionStartPct: num("PROFIT_PROTECTION_START_PCT", 8),
  profitProtectionFloorPct: num("PROFIT_PROTECTION_FLOOR_PCT", 3),
  profitProtectionRatio: num("PROFIT_PROTECTION_RATIO", 0.40),
  earlyExitLossPct: num("EARLY_EXIT_LOSS_PCT", -10),
  earlyExitTrend1hPct: num("EARLY_EXIT_TREND_1H_PCT", -8),
  momentumExitProfitPct: num("MOMENTUM_EXIT_PROFIT_PCT", 8),
  momentumExitTrend1hPct: num("MOMENTUM_EXIT_TREND_1H_PCT", -10),
  momentumExitReboundPct: num("MOMENTUM_EXIT_REBOUND_1H_PCT", 2),
  sellPressureExitRatio: num("SELL_PRESSURE_EXIT_RATIO", 0.65),
  sellPressureMinVolumeUsd: Math.max(0, num("SELL_PRESSURE_MIN_VOLUME_USD", 1000)),
  minTrend4hPct: num("MIN_TREND_4H_PCT", -25),
  liquidityExitRatio: num("LIQUIDITY_EXIT_RATIO", 0.65),
  maxQuoteFailures: Math.max(1, Math.floor(num("MAX_QUOTE_FAILURES", 3))),

  eventPollMs: num("EVENT_POLL_MS", 800),
  positionLoopMs: num("POSITION_LOOP_MS", 2200),
  aiPositionReviewMs: num("AI_POSITION_REVIEW_MS", 30000),
  aiFastCooldownMs: num("AI_FAST_COOLDOWN_MS", 4000),
  aiMaxCallsPerCycle: Math.max(1, Math.min(3, Math.floor(num("AI_MAX_CALLS_PER_CYCLE", 2)))),
  aiMaxCallsPerDay: Math.max(10, Math.min(500, Math.floor(num("AI_MAX_CALLS_PER_DAY", 120)))),
  aiMaxAttemptsPerDecision: Math.max(1, Math.min(2, Math.floor(num("AI_MAX_ATTEMPTS_PER_DECISION", 1)))),
  reentryCooldownMs: Math.max(15 * 60 * 1000, num("REENTRY_COOLDOWN_MS", 60 * 60 * 1000)),
  aiFallbackEnabled: bool("AI_FALLBACK_ENABLED", true),
  aiFallbackMinScore: num("AI_FALLBACK_MIN_SCORE", 55),
  aiOverrideScore: num("AI_OVERRIDE_SCORE", 75),
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
  minVolumeUsd: Math.max(0, num("MIN_VOLUME_USD", 1000)),
  // Separate early-stage momentum lane. It can consider risky sub-$25k tokens,
  // but only when short-term flow/volume is unusually strong.
  lowCapMomentumEnabled: bool("LOW_CAP_MOMENTUM_ENABLED", true),
  lowCapMinMarketCapUsd: Math.max(1000, num("LOW_CAP_MIN_MARKET_CAP_USD", 8000)),
  lowCapMaxMarketCapUsd: Math.max(1000, num("LOW_CAP_MAX_MARKET_CAP_USD", 25000)),
  lowCapMinLiquidityUsd: Math.max(500, num("LOW_CAP_MIN_LIQUIDITY_USD", 2500)),
  lowCapMinHolders: Math.max(3, Math.floor(num("LOW_CAP_MIN_HOLDERS", 10))),
  lowCapMinVolumeUsd: Math.max(0, num("LOW_CAP_MIN_VOLUME_USD", 1000)),
  lowCapMinAgeMinutes: Math.max(2, num("LOW_CAP_MIN_AGE_MINUTES", 5)),
  lowCapCandidateMaxAgeSeconds: Math.max(180, num("LOW_CAP_CANDIDATE_MAX_AGE_SECONDS", 900)),
  lowCapMinBuySellRatio5m: Math.max(1, num("LOW_CAP_MIN_BUY_SELL_RATIO_5M", 1.35)),
  lowCapMinVolume5mUsd: Math.max(0, num("LOW_CAP_MIN_VOLUME_5M_USD", 1000)),
  lowCapMinVolumeAcceleration5m: Math.max(1, num("LOW_CAP_MIN_VOLUME_ACCELERATION_5M", 1.25)),
  lowCapMinTrend1hPct: num("LOW_CAP_MIN_TREND_1H_PCT", 3),
  lowCapMinScore: Math.max(0, num("LOW_CAP_MIN_SCORE", 45)),
  lowCapLiquidityExitRatio: Math.min(1, Math.max(0.5, num("LOW_CAP_LIQUIDITY_EXIT_RATIO", 0.80))),
  lowCapSellPressureRatio: Math.min(1, Math.max(0.4, num("LOW_CAP_SELL_PRESSURE_RATIO", 0.75))),
  lowCapSellPressureMinVolumeUsd: Math.max(0, num("LOW_CAP_SELL_PRESSURE_MIN_VOLUME_USD", 1000)),
  lowCapTrendExitPct: num("LOW_CAP_TREND_EXIT_PCT", -5),
  lowCapLossExitPct: num("LOW_CAP_LOSS_EXIT_PCT", -2),
  lowCapPeakDrawdownExitPct: Math.max(1, num("LOW_CAP_PEAK_DRAWDOWN_EXIT_PCT", 6)),
  lowCapMaxLiquidityPositionPct: Math.min(10, Math.max(0.5, num("LOW_CAP_MAX_LIQUIDITY_POSITION_PCT", 2))),
  lowCapFlowApiCandidateLimit: Math.max(1, Math.min(8, Math.floor(num("LOW_CAP_FLOW_API_CANDIDATE_LIMIT", 4)))),
  highCapMinMarketCapUsd: Math.max(250000, num("HIGH_CAP_MIN_MARKET_CAP_USD", 250000)),
  highCapMinVolume5mUsd: Math.max(1000, num("HIGH_CAP_MIN_VOLUME_5M_USD", 2500)),
  highCapMinBuySellRatio5m: Math.max(1, num("HIGH_CAP_MIN_BUY_SELL_RATIO_5M", 1.05)),
  highCapMinBuyMakers5m: Math.max(2, Math.floor(num("HIGH_CAP_MIN_BUY_MAKERS_5M", 5))),
  highCapMinTrend4hPct: num("HIGH_CAP_MIN_TREND_4H_PCT", 0),
  flowApiRefreshMs: Math.max(15000, num("FLOW_API_REFRESH_MS", 30000)),
  dipMinPct: Math.max(0, num("DIP_MIN_PCT", 3)),
  dipMaxPct: Math.max(1, num("DIP_MAX_PCT", 50)),
  recoveryMinPct: num("RECOVERY_MIN_PCT", -10),
  trendMax1hPct: num("TREND_MAX_1H_PCT", 20),
  discoveryLimit: Math.max(10, Math.min(50, Math.floor(num("DISCOVERY_LIMIT", 50)))),
  aiCandidateLimit: Math.max(1, Math.min(15, Math.floor(num("AI_CANDIDATE_LIMIT", 8)))),
  aiCandidateCooldownMs: Math.max(10_000, num("AI_CANDIDATE_COOLDOWN_MS", 30_000)),
  discoveryPollMs: Math.max(30000, num("DISCOVERY_POLL_MS", 60000)),
  priceSampleMs: Math.max(30000, num("PRICE_SAMPLE_MS", 60000)),
  minVolume5mUsd: Math.max(0, num("MIN_VOLUME_5M_USD", 1000)),
  fastCycleMs: Math.max(10000, num("FAST_CYCLE_MS", 10000)),

  leverUpEnabled: bool("LEVERUP_ENABLED", false),
  leverUpDiamond: (process.env.LEVERUP_DIAMOND ?? "0xea1b8E4aB7f14F7dCA68c5B214303B13078FC5ec") as `0x${string}`,
  leverUpAgentPrivateKey: process.env.LEVERUP_AGENT_PRIVATE_KEY ?? "",
  // LeverUp supports an ALL permission wildcard. GELD accepts ALL or an explicit bitmask.
  // Default is ALL because this hosted agent is dedicated to GELD.
  leverUpAgentPermissionMask: bigint("LEVERUP_AGENT_PERMISSION_MASK", (2n ** 256n) - 1n),
  // Auto-approve only the exact WMON/fee-token amount needed immediately before a live LeverUp trade.
  // This never grants an unlimited allowance.
  leverUpAutoApprove: bool("LEVERUP_AUTO_APPROVE", true),
  leverUpPythHermesUrl: process.env.LEVERUP_PYTH_HERMES_URL ?? "https://pyth.dourolabs.app/hermes",
  leverUpPythApiKey: process.env.PYTH_API_KEY ?? "",
  leverUpDefaultLeverage: Math.max(1, Math.floor(num("LEVERUP_DEFAULT_LEVERAGE", 10))),
  leverUpMaxLeverage: Math.max(1, Math.floor(num("LEVERUP_MAX_LEVERAGE", 25))),
  leverUpMinNotionalUsd: Math.max(0, num("LEVERUP_MIN_NOTIONAL_USD", 0)),
  // Optional local safety floor; 0 means no invented minimum beyond LeverUp validation.
  leverUpMinMarginUsd: Math.max(0, num("LEVERUP_MIN_MARGIN_USD", 0)),
  leverUpMaxMarginPct: Math.min(25, Math.max(1, num("LEVERUP_MAX_MARGIN_PCT", 10))),
  leverUpRiskPerTradePct: Math.min(5, Math.max(0.25, num("LEVERUP_RISK_PER_TRADE_PCT", 1))),
  leverUpDailyLossLimitPct: Math.min(10, Math.max(1, num("LEVERUP_DAILY_LOSS_LIMIT_PCT", 4))),
  leverUpMaxConsecutiveLosses: Math.max(2, Math.min(8, Math.floor(num("LEVERUP_MAX_CONSECUTIVE_LOSSES", 3)))),
  leverUpCooldownMs: Math.max(60_000, num("LEVERUP_COOLDOWN_MS", 15 * 60_000)),
  leverUpAutoLiveAfterPaper: bool("LEVERUP_AUTO_LIVE_AFTER_PAPER", false),

  nadfunApiUrl: process.env.NADFUN_API_URL ?? "https://api.nad.fun",
  nadfunSiteUrl: process.env.NADFUN_SITE_URL ?? "https://nad.fun",
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
