import React from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";

function App() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-7xl">
        <div className="text-xs tracking-[0.3em] text-lime-400">GELD // NAD.FUN</div>
        <h1 className="mt-2 text-3xl font-bold">MONAD MEME TERMINAL</h1>
        <p className="mt-2 text-sm text-zinc-400">
          React is mounted successfully. Dashboard modules are temporarily isolated for production debugging.
        </p>
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="text-sm font-semibold">Production shell online</div>
          <div className="mt-2 text-xs text-zinc-500">
            This confirms the Vite bundle, React entrypoint, Tailwind CSS, and root mount are working.
          </div>
        </div>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("GELD: #root element is missing from index.html");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
