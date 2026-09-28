import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  GELD_CONTAINER: DurableObjectNamespace<GeldContainer>;
  GELD_STATE: DurableObjectNamespace<GeldState>;
  MONAD_PRIVATE_KEY?: string;
  GEMINI_API_KEYS?: string;
  STATE_SYNC_SECRET?: string;
  STATE_SYNC_URL?: string;
  MONAD_RPC_URL?: string;
  MONAD_WS_URL?: string;
}

export class GeldState extends DurableObject<Env> {
  async fetch(request: Request) {
    const secret = this.env.STATE_SYNC_SECRET;
    if (secret && request.headers.get("x-geld-state-secret") !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method === "GET") {
      const value = await this.ctx.storage.get<string>("snapshot");
      return Response.json(value ? JSON.parse(value) : null);
    }

    if (request.method === "POST") {
      const body = await request.text();
      JSON.parse(body);
      await this.ctx.storage.put("snapshot", body);
      return Response.json({ ok: true });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}

export class GeldContainer extends Container<Env> {
  defaultPort = 8787;
  requiredPorts = [8787];
  sleepAfter = "24h";
  enableInternet = true;
  entrypoint = ["node", "dist/src/index.js"];
  envVars = {
    NODE_ENV: "production",
    BOT_PORT: "8787",
    MONAD_PRIVATE_KEY: this.env.MONAD_PRIVATE_KEY ?? "",
    GEMINI_API_KEYS: this.env.GEMINI_API_KEYS ?? "",
    STATE_SYNC_SECRET: this.env.STATE_SYNC_SECRET ?? "",
    STATE_SYNC_URL: this.env.STATE_SYNC_URL ?? "",
    MONAD_RPC_URL: this.env.MONAD_RPC_URL ?? "",
    MONAD_WS_URL: this.env.MONAD_WS_URL ?? ""
  };

  override onStart() { console.log("geld container started"); }
  override onStop(params: unknown) { console.log("geld container stopped", params); }
  override onError(error: unknown) { console.error("geld container error", error); }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/internal/state/")) {
      const id = env.GELD_STATE.idFromName("singleton");
      const innerPath = url.pathname.replace("/internal/state", "") || "/";
      return env.GELD_STATE.get(id).fetch(new Request(new URL(innerPath, url), request));
    }

    const container = getContainer(env.GELD_CONTAINER, "singleton");
    if (url.pathname === "/start") {
      await container.startAndWaitForPorts({
        cancellationOptions: { portReadyTimeoutMS: 30000 }
      });
      return Response.json({ ok: true, started: true });
    }

    return container.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env) {
    const container = getContainer(env.GELD_CONTAINER, "singleton");
    try {
      await container.startAndWaitForPorts({
        cancellationOptions: { portReadyTimeoutMS: 30000 }
      });
    } catch (error) {
      console.error("scheduled container start failed", error);
    }
  }
};
