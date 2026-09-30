import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBot } from "./context";

function pct(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0.0%";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function status(token: any) {
  const d = token.entryDiagnostics;
  if (!d) return { label: "NO DATA", className: "border-zinc-700 text-zinc-400" };
  if (d.blockers?.length) {
    if (d.aiAction === "BUY") {
      return { label: "BUY BLOCKED", className: "border-amber-800 text-amber-300" };
    }
    return { label: "WATCH", className: "border-zinc-700 text-zinc-400" };
  }
  if (d.aiAction === "BUY") return { label: `AI BUY ${Math.round((d.aiConfidence ?? 0) * 100)}%`, className: "border-lime-800 text-lime-300" };
  if (d.aiAction === "HOLD") return { label: "AI HOLD", className: "border-sky-800 text-sky-300" };
  return { label: "READY", className: "border-lime-900 text-lime-400" };
}

export function CandidateDiagnostics() {
  const s = useBot();
  const rows = Object.values(s.tokens ?? {})
    .sort((a: any, b: any) => Number(b.localScore ?? 0) - Number(a.localScore ?? 0))
    .slice(0, 10);

  return (
    <Card className="col-span-1 md:col-span-2 lg:col-span-4">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Entry diagnostics</CardTitle>
          <div className="text-xs text-zinc-500">
            exact gate failures · refreshed with market discovery
          </div>
        </div>
        <div className="text-right text-[10px] uppercase tracking-wider text-zinc-500">
          <div>
            discovered {s.stats?.discoveredTokens ?? 0} · watched {s.stats?.watchedTokens ?? 0} · AI queue {s.stats?.eligibleCandidates ?? 0}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!rows.length ? (
          <div className="rounded-lg border border-zinc-800 bg-black/20 p-4 text-sm text-zinc-500">
            No discovered tokens yet.
          </div>
        ) : (
          rows.map((token: any) => {
            const d = token.entryDiagnostics;
            const st = status(token);
            const blockers = d?.blockers ?? [];
            const m = d?.metrics;
            return (
              <div key={token.token} className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-16 font-semibold">{token.symbol ?? "?"}</div>
                  <div className="text-xs text-zinc-500">score {Number(token.localScore ?? 0).toFixed(0)}</div>
                  <Badge variant="outline" className={st.className}>{st.label}</Badge>
                  <div className="min-w-0 flex-1 text-xs text-zinc-300">
                    {blockers.length ? blockers.join(" · ") : (d?.primary ?? "ready for AI evaluation")}
                  </div>
                </div>
                {m ? (
                  <div className="mt-1 pl-[76px] text-[10px] text-zinc-600">
                    {money(m.liquidityUsd)} liq · {Number(m.holders ?? 0)} holders · {Number(m.volumeMon ?? 0).toFixed(1)} MON vol · dip {Number(m.dipPct ?? 0).toFixed(1)}% · 1h {pct(m.trend1hPct)} · 4h {pct(m.trend4hPct)} · rebound {pct(m.rebound1hPct)} · age {Number(m.ageMinutes ?? 0).toFixed(0)}m
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export default CandidateDiagnostics;
