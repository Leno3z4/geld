import express from "express";

function getBackendUrl() {
  const base = process.env.GELD_CLOUDFLARE_URL?.trim().replace(/\/$/, "");
  if (!base) throw new Error("GELD_CLOUDFLARE_URL is not configured");
  return base;
}

function readBody(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxy(req: any, res: any) {
  try {
    const base = getBackendUrl();
    const target = new URL(req.originalUrl, base);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers ?? {})) {
      if (
        value == null ||
        key === "host" ||
        key === "content-length" ||
        key === "connection"
      ) continue;

      headers.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }

    const secret = process.env.GELD_CLOUDFLARE_SECRET;
    if (!secret) throw new Error("GELD_CLOUDFLARE_SECRET is not configured");
    headers.set("x-geld-api-secret", secret);

    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await readBody(req);

    const remote = await fetch(target, {
      method: req.method,
      headers,
      body: body as any,
      redirect: "manual"
    });

    res.status(remote.status);

    remote.headers.forEach((value, key) => {
      if (
        key !== "content-length" &&
        key !== "connection" &&
        key !== "transfer-encoding"
      ) {
        res.setHeader(key, value);
      }
    });

    const payload = Buffer.from(await remote.arrayBuffer());
    res.end(payload);
  } catch (error) {
    console.error("geld cloudflare proxy error", error);
    if (!res.headersSent) {
      res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    } else {
      res.end();
    }
  }
}

const app = express();
app.use("/api", proxy);

app.get("/health", (_req: any, res: any) => {
  res.json({
    ok: true,
    service: "geld-vercel-proxy",
    backendConfigured: Boolean(process.env.GELD_CLOUDFLARE_URL)
  });
});

if (process.env.VERCEL !== "1") {
  app.listen(process.env.PORT ? Number(process.env.PORT) : 8787, "0.0.0.0");
}

export default app;
