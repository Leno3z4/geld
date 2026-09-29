import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";

const Dashboard = lazy(() => import("@/components/ui/dashboard-4"));

class DashboardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("GELD dashboard render error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="mt-6 rounded-xl border border-red-900/60 bg-red-950/20 p-5">
        <div className="text-xs uppercase tracking-[0.3em] text-red-400">
          GELD // DASHBOARD MODULE ERROR
        </div>
        <h2 className="mt-2 text-lg font-semibold">Dashboard modules failed to load</h2>
        <p className="mt-2 text-sm text-zinc-400">
          The production shell is working. The dashboard module reported this error:
        </p>
        <pre className="mt-4 overflow-auto rounded-lg bg-black/50 p-3 text-xs text-red-300">
          {this.state.error.message}
        </pre>
      </section>
    );
  }
}

function App() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-7xl">
        <div className="text-xs tracking-[0.3em] text-lime-400">GELD // NAD.FUN</div>
        <h1 className="mt-2 text-3xl font-bold">MONAD MEME TERMINAL</h1>
        <p className="mt-2 text-sm text-zinc-400">
          AI flow engine · seasonality · live execution telemetry
        </p>

        <DashboardErrorBoundary>
          <Suspense
            fallback={
              <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 text-sm text-zinc-400">
                Loading dashboard modules…
              </div>
            }
          >
            <div className="mt-6">
              <Dashboard />
            </div>
          </Suspense>
        </DashboardErrorBoundary>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("GELD: #root element is missing from index.html");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
