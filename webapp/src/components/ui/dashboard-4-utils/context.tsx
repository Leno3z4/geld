import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type DashboardState = {
  running: boolean;
  liveTrading: boolean;
  walletAddress: string;
  balanceMon: number;
  realizedPnlMon: number;
  unrealizedPnlMon: number;
  openExposureMon: number;
  tokens: Record<string, any>;
  positions: Record<string, any>;
  trades: any[];
  equity: any[];
  stats: {
    aiCalls: number;
    aiFailures: number;
    eventCount: number;
    wins: number;
    losses: number;
    lastProcessedBlock?: string;
    lastCycleAt?: number;
    lastError?: string;
    lastDiscoveryAt?: number;
    discoveredTokens?: number;
    watchedTokens?: number;
    eligibleCandidates?: number;
  };
  arbitrage?: any;
};

const initialState: DashboardState = {
  running: false,
  liveTrading: false,
  walletAddress: "",
  balanceMon: 0,
  realizedPnlMon: 0,
  unrealizedPnlMon: 0,
  openExposureMon: 0,
  tokens: {},
  positions: {},
  trades: [],
  equity: [],
  stats: {
    aiCalls: 0,
    aiFailures: 0,
    eventCount: 0,
    wins: 0,
    losses: 0
  },
  arbitrage: null
};

const C = createContext<DashboardState>(initialState);

export function useBot() {
  return useContext(C);
}

const CLOUDFLARE_API_BASE = "https://geld.mahoraga6190.workers.dev";

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState>(initialState);
  const [apiError, setApiError] = useState<string>("");

  useEffect(() => {
    let mounted = true;

    const applyState = (next: DashboardState) => {
      if (!mounted || !next) return;
      setState({
        ...initialState,
        ...next,
        tokens: next.tokens ?? {},
        positions: next.positions ?? {},
        trades: next.trades ?? [],
        equity: next.equity ?? [],
        stats: {
          ...initialState.stats,
          ...(next.stats ?? {})
        },
        arbitrage: next.arbitrage ?? null
      });
      setApiError("");
    };

    const refresh = async () => {
      try {
        const response = await fetch(CLOUDFLARE_API_BASE + "/api/state", {
          headers: { accept: "application/json" },
          cache: "no-store"
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        applyState(await response.json() as DashboardState);
      } catch (error) {
        if (mounted) setApiError(error instanceof Error ? error.message : String(error));
      }
    };

    void refresh();

    const refreshArbitrage = async () => {
      try {
        const response = await fetch(CLOUDFLARE_API_BASE + "/api/arbitrage/discovery", {
          headers: { accept: "application/json" },
          cache: "no-store"
        });
        if (!response.ok) throw new Error(`Arbitrage API ${response.status}`);
        if (!mounted) return;
        const arbitrage = await response.json();
        setState(current => ({ ...current, arbitrage }));
      } catch (error) {
        if (mounted) {
          console.warn("GELD arbitrage discovery refresh failed", error);
        }
      }
    };

    void refreshArbitrage();
    const timer = window.setInterval(() => void refresh(), 5000);
    const arbitrageTimer = window.setInterval(() => void refreshArbitrage(), 30000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.clearInterval(arbitrageTimer);
    };
  }, []);

  return (
    <C.Provider value={state}>
      {apiError ? (
        <div className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          Dashboard API: {apiError}. Showing the last known state until the backend responds.
        </div>
      ) : null}
      {children}
    </C.Provider>
  );
}
