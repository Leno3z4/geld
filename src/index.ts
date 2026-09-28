import { TradingEngine } from "./engine.js";
import { config } from "./config.js";
import { startServer } from "./server.js";

const engine = new TradingEngine();
await engine.init();
startServer(engine, config.port);

process.on("SIGTERM", async () => { await engine.stop(); process.exit(0); });
process.on("SIGINT", async () => { await engine.stop(); process.exit(0); });

if (config.autoStart) await engine.start();
