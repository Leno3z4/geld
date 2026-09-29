import React from "react";
import { createRoot, type ErrorInfo, type ReactNode } from "react";
import Dashboard from "@/components/ui/dashboard-4";
import "@/index.css";

class DashboardErrorBoundary extends React.Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("GELD dashboard render error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-background p-6 text-foreground">
          <div className="mx-auto max-w-3xl rounded-xl border border-red-900/60 bg-red-950/20 p-5">
            <div className="text-xs uppercase tracking-[0.3em] text-red-400">
              GELD // DASHBOARD ERROR
            </div>
            <h1 className="mt-2 text-xl font-semibold">Dashboard failed to render</h1>
            <p className="mt-2 text-sm text-zinc-400">
              The application is still running. Refresh after the next deployment or inspect the
              browser console for the component error.
            </p>
            <pre className="mt-4 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-red-300">
              {this.state.error.message}
            </pre>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DashboardErrorBoundary>
      <div className="min-h-screen bg-background p-4 text-foreground md:p-6">
        <div className="mx-auto mb-5 max-w-7xl">
          <div className="text-xs tracking-[.3em] text-lime-400">GELD // NAD.FUN</div>
          <h1 className="mt-1 text-2xl font-bold">MONAD MEME TERMINAL</h1>
          <p className="mt-1 text-xs text-zinc-500">
            AI flow engine · seasonality · live execution telemetry
          </p>
        </div>
        <Dashboard />
      </div>
    </DashboardErrorBoundary>
  </React.StrictMode>,
);
