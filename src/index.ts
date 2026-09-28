import { TradingEngine } from "./engine.js";
import { config } from "./config.js";
import { createApp, startServer } from "./server.js";

const engine = new TradingEngine();
await engine.init();

const app = createApp(engine);
export default app;

if (process.env.VERCEL !== "1") {
  startServer(engine, config.port);
}

if (config.autoStart) {
  await engine.start();
}

process.on("SIGTERM", async () => { await engine.stop(); process.exit(0); });
process.on("SIGINT", async () => { await engine.stop(); process.exit(0); });
