export type DecisionAction = "BUY" | "HOLD" | "SELL";

export interface TokenSnapshot {
  token: string;
  symbol: string;
  name: string;
  creator: string;
  pair: string;
  quoteToken?: string;
  createdBlock?: string;
  virtualTokenStart?: string;
  virtualTokenReserve?: string;
  minTokenReserve?: string;
  createdAt: number;
  lastEventAt: number;
  buys: number;
  sells: number;
  buyMon: number;
  sellMon: number;
  progressPct: number;
  graduated: boolean;
  locked: boolean;
  holders: number;
  volumeUsd: number;
  priceUsd: number;
  priceMon: number;
  peakPriceMon: number;
  localScore: number;
  marketType?: "BONDING_CURVE" | "DEX";
  liquidityMon?: number;
  marketCapMon?: number;
  volumeMon?: number;
  changePct?: number;
  athPriceMon?: number;
  dipPct?: number;
  trendPct1h?: number;
  trendPct4h?: number;
  lastMarketAt?: number;
  priceHistory?: Array<{ ts: number; priceMon: number }>;
  watchReason?: string;
  lastCandidateAiAt?: number;
  lastEnrichedAt?: number;
  aiAction?: DecisionAction;
  aiConfidence?: number;
  aiReason?: string;
}

export interface Position {
  id: string;
  token: string;
  symbol: string;
  amountRaw: string;
  decimals: number;
  entryMon: number;
  entryPriceMon: number;
  currentMon: number;
  pnlMon: number;
  pnlPct: number;
  peakMon: number;
  openedAt: number;
  lastAiAt: number;
  lastAiAction?: DecisionAction;
  lastAiConfidence?: number;
  lastAiReason?: string;
  entryTx: string;
  status: "OPEN" | "CLOSED" | "CLOSING" | "FAILED";
  closeTx?: string;
  closeReason?: string;
}

export interface TradeRecord {
  id: string;
  ts: number;
  action: "BUY" | "SELL";
  token: string;
  symbol: string;
  amountMon: number;
  pnlMon?: number;
  pnlPct?: number;
  txHash?: string;
  reason: string;
  score?: number;
  aiConfidence?: number;
}

export interface EquityPoint {
  ts: number;
  balanceMon: number;
  realizedPnlMon: number;
}

export interface BotStats {
  aiCalls: number;
  aiFailures: number;
  eventCount: number;
  wins: number;
  losses: number;
  lastProcessedBlock?: string;
  lastCycleAt?: number;
  lastError?: string;
  startedAt?: number;
  lastLogCount?: number;
  lastLogPollAt?: number;
  eventBackfillDone?: boolean;
  lastDiscoveryAt?: number;
  discoveredTokens?: number;
  watchedTokens?: number;
  eligibleCandidates?: number;
}

export interface BotState {
  version: 1;
  running: boolean;
  liveTrading: boolean;
  walletAddress: string;
  balanceMon: number;
  realizedPnlMon: number;
  unrealizedPnlMon: number;
  openExposureMon: number;
  seasonality: Record<string, { buyMon: number; sellMon: number; events: number }>;
  tokens: Record<string, TokenSnapshot>;
  positions: Record<string, Position>;
  trades: TradeRecord[];
  equity: EquityPoint[];
  stats: BotStats;
}
