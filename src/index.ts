import express, { type Express } from "express";
import { Readable } from "node:stream";

function getBackendUrl() {
  const base = process.env.GELD_CLOUDFLARE_URL?.trim().replace(/\/$/, "");
  if (!base) throw new Error("GELD_CLOUDFLARE_URL is not configured");
  return base;
}

function copyRequestBody(req: express.Request) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createProxyApp(existingApp?: Express) {
  const app = existingApp ?? express();

  app.all("/api{/:rest}", async (req, res) => {
    try {
      const base = getBackendUrl();
      const target = new URL(req.originalUrl, base);

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null || key === "host" || key === "content-length" || key === "connection") continue;
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }

      const secret = process.env.GELD_CLOUDFLARE_SECRET;
      if (!secret) throw new Error("GELD_CLOUDFLARE_SECRET is not configured");
      headers.set("x-geld-api-secret", secret);

      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await copyRequestBody(req);
      const remote = await fetch(target, {
        method: req.method,
        headers,
        body,
        redirect: "manual"
      });

      res.status(remote.status);
      remote.headers.forEach((value, key) => {
        if (key !== "content-length" && key !== "connection" && key !== "transfer-encoding") {
          res.setHeader(key, value);
        }
      });

      if (!remote.body) {
        res.end();
        return;
      }

      Readable.fromWeb(remote.body as any).pipe(res);
    } catch (error) {
      console.error("geld cloudflare proxy error", error);
      res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "geld-vercel-proxy", backendConfigured: Boolean(process.env.GELD_CLOUDFLARE_URL) });
  });

  return app;
}

const app = createProxyApp();
app.listen(process.env.PORT ? Number(process.env.PORT) : 8787, "0.0.0.0");
export default app;
