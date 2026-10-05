import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBot } from "./context";

function pct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `\${n >= 0 ? "+" : ""}\${n.toFixed(2)}%` : "—";
}

function usd(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "m";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "k";
  return "$" + n.toFixed(0);
}

export function ArbitrageOpportunities() {
  const s = useBot();
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"potential" | "all">("potential");

  const arb = s.arbitrage;
  const potential = Array.isArray(arb?.arbitragePotentialTokens)
    ? arb.arbitragePotentialTokens
    : [];
  const discovered = Array.isArray(arb?.discoveredTokens)
    ? arb.discoveredTokens
    : [];
  const monitored = Object.values(s.tokens ?? {});

  const potentialByAddress = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of potential) {
      const address = String(item?.address ?? "").toLowerCase();
      if (address) map.set(address, item);
    }
    return map;
  }, [potential]);

  const rows = useMemo(() => {
    const source = view === "potential"
      ? potential
      : discovered.map((item: any) => ({
          ...item,
          ...(potentialByAddress.get(String(item?.address ?? "").toLowerCase()) ?? {}),
          discoveredOnly: !potentialByAddress.has(String(item?.address ?? "").toLowerCase())
        }));

    const needle = filter.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((item: any) =>
      String(item.symbol ?? "").toLowerCase().includes(needle) ||
      String(item.address ?? "").toLowerCase().includes(needle) ||
      (Array.isArray(item.venues) && item.venues.some((venue: string) =>
        venue.toLowerCase().includes(needle)
      ))
    );
  }, [potential, discovered, monitored, potentialByAddress, filter, view]);

  const exactRoutes = Number(arb?.routeCount ?? 0);
  const discoveryRoutes = Number(arb?.discoveryRouteCount ?? 0);
  const poolCount = Number(arb?.poolCount ?? 0);
  const tokenCount = Number(arb?.discoveredTokenCount ?? arb?.assets?.length ?? 0);
  const dexCount = Number(arb?.availableDexCount ?? 0);

  return (
    <Card className="col-span-1 md:col-span-2 lg:col-span-4">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Arbitrage universe</CardTitle>
          <div className="text-xs text-zinc-500">
            dynamic token discovery · every indexed Monad DEX · exact execution separated from discovery
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
          <div className="flex rounded-lg border border-zinc-800 bg-black/20 p-1">
            <button
              type="button"
              onClick={() => setView("potential")}
              className={`rounded-md px-3 py-1.5 text-[10px] uppercase tracking-wider ${view === "potential" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"}`}
            >
              Potential ({potential.length})
            </button>
            <button
              type="button"
              onClick={() => setView("all")}
              className={`rounded-md px-3 py-1.5 text-[10px] uppercase tracking-wider ${view === "all" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"}`}
            >
              All available ({new Set([
                ...discovered.map((item: any) => String(item?.address ?? "").toLowerCase()),
                ...monitored.map((item: any) => String(item?.token ?? item?.address ?? "").toLowerCase())
              ].filter(Boolean)).size})
            </button>
          </div>
          <input
            value={filter}
            onChange={event => setFilter(event.target.value)}
            placeholder="Filter token / venue"
            className="w-full rounded-lg border border-zinc-800 bg-black/30 px-3 py-2 text-xs text-zinc-200 outline-none md:w-64"
          />
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Tokens discovered</div>
            <div className="mt-1 text-xl font-semibold">{tokenCount}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Pools scanned</div>
            <div className="mt-1 text-xl font-semibold">{poolCount}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">DEXes</div>
            <div className="mt-1 text-xl font-semibold">{dexCount}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Exact routes</div>
            <div className="mt-1 text-xl font-semibold">{exactRoutes}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
          <span>{rows.length} {view === "potential" ? "potential tokens" : "discovered tokens"} shown</span>
          <span>·</span>
          <span>{discoveryRoutes} route topologies</span>
          <span>·</span>
          <span>not a profitability guarantee</span>
        </div>

        <div className="mt-3 max-h-[560px] overflow-auto rounded-lg border border-zinc-800">
          {rows.length ? (
            <div className="divide-y divide-zinc-900">
              {rows.map((item: any) => (
                <div key={item.address} className="grid gap-2 px-3 py-3 md:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,2fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{item.symbol}</span>
                      {item.exactSupported ? (
                        <Badge variant="outline" className="border-lime-900 text-lime-400">EXACT</Badge>
                      ) : item.discoveredOnly ? (
                        <Badge variant="outline" className="border-zinc-700 text-zinc-500">DISCOVERED</Badge>
                      ) : (
                        <Badge variant="outline" className="border-zinc-700 text-zinc-500">DISCOVERY</Badge>
                      )}
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-zinc-600">{item.address}</div>
                  </div>

                  <div className="text-left md:text-right">
                    <div className="text-xs text-zinc-300">{item.venueCount} venues</div>
                    <div className="text-[10px] text-zinc-600">{item.poolCount} pools</div>
                  </div>

                  <div className="min-w-0 text-xs text-zinc-400">
                    <div className="truncate">{(item.venues ?? []).join(" · ")}</div>
                    <div className="mt-1 text-[10px] text-zinc-600">
                      liquidity {usd(item.maxLiquidityUsd)} · 24h vol {usd(item.volume24hUsd)}
                    </div>
                  </div>

                  <div className="text-left md:text-right">
                    <div className="text-sm font-semibold text-lime-300">
                      {item.priceSpreadPct == null ? "spread —" : pct(item.priceSpreadPct)}
                    </div>
                    <div className="text-[10px] text-zinc-600">
                      {item.reason?.join(" · ") ?? (item.discoveredOnly ? "awaiting pool evidence" : "multi-venue")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-sm text-zinc-500">
              No dynamic arbitrage candidates are currently available.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default ArbitrageOpportunities;
