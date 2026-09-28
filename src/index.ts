import express from "express";
import { TradingEngine } from "./engine.js";
import { config } from "./config.js";
import { createApp } from "./server.js";

const engine = new TradingEngine();
await engine.init();

const app = createApp(engine, express());
export default app;

if (process.env.VERCEL !== "1") {
  app.listen(config.port, "0.0.0.0", () => {
    console.log("geld listening on " + config.port);
  });
}

if (config.autoStart) {
  await engine.start();
}

process.on("SIGTERM", async () => { await engine.stop(); process.exit(0); });
process.on("SIGINT", async () => { await engine.stop(); process.exit(0); });
