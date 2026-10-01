import express, { type Express, type Response } from "express";
import type { TradingEngine } from "./engine.js";
import { config } from "./config.js";

export function createApp(engine: TradingEngine, existingApp?: Express) {
  const app = existingApp ?? express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    const s = engine.snapshot();
    res.json({
      ok: true,
      running: s.running,
      liveTrading: s.liveTrading,
      walletAddress: s.walletAddress,
      balanceMon: s.balanceMon,
      openPositions: Object.values(s.positions).filter((p) => p.status === "OPEN").length,
      chainId: 143,
      minLiquidityUsd: config.minLiquidityUsd,
      minMarketCapUsd: config.minMarketCapUsd
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      network: config.network,
      chainId: config.chainId,
      liveTrading: config.liveTrading,
      autoStart: config.autoStart,
      minLiquidityUsd: config.minLiquidityUsd,
      minMarketCapUsd: config.minMarketCapUsd,
      minEstablishedAgeMinutes: config.minEstablishedAgeMinutes,
      minHolders: config.minHolders,
      minVolumeUsd: config.minVolumeUsd,
      dipMinPct: config.dipMinPct,
      dipMaxPct: config.dipMaxPct,
      trendMax1hPct: config.trendMax1hPct,
      minTrend4hPct: config.minTrend4hPct,
      positionSizePct: config.positionSizePct,
      maxTotalExposurePct: config.maxTotalExposurePct,
      maxOpenPositions: config.maxOpenPositions,
      maxHoldMinutes: config.maxHoldMinutes
    });
  });

  app.get("/api/state", (_req, res) => res.json(engine.snapshot()));
  app.get("/api/positions", (_req, res) => res.json(Object.values(engine.snapshot().positions)));
  app.get("/api/tokens", (_req, res) => res.json(Object.values(engine.snapshot().tokens).sort((a, b) => b.localScore - a.localScore).slice(0, 100)));
  app.get("/api/trades", (_req, res) => res.json(engine.snapshot().trades));

  app.post("/api/start", async (_req, res) => {
    try { await engine.start(); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  });

  app.post("/api/stop", async (_req, res) => {
    await engine.stop(); res.json({ ok: true });
  });

  app.post("/api/sell-all", async (_req, res) => {
    await engine.sellAll(); res.json({ ok: true });
  });

  app.get("/api/events", (req, res: Response) => {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders();

    const send = () => {
      res.write("event: state\n");
      res.write("data: " + JSON.stringify(engine.snapshot()) + "\n\n");
    };

    send();
    const unsubscribe = engine.onUpdate(send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
  });

  return app;
}

export function startServer(engine: TradingEngine, port: number) {
  return createApp(engine).listen(port, "0.0.0.0", () => {
    console.log("geld listening on " + port);
  });
}
