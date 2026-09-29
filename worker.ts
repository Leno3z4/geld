import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  GELD_CONTAINER: DurableObjectNamespace<GeldContainer>;
  GELD_STATE: DurableObjectNamespace<GeldState>;

  // Worker Secrets / vars.
  GELD_API_SECRET?: string;
  GELD_LIVE_TRADING?: string;
  GELD_AUTO_START?: string;

  MONAD_PRIVATE_KEY?: string;
  GEMINI_API_KEYS?: string;
  NADFUN_API_KEY?: string;
  STATE_SYNC_SECRET?: string;
  STATE_SYNC_URL?: string;
  MONAD_RPC_URL?: string;
  MONAD_WS_URL?: string;
}

function isTrue(value?: string) {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function isAuthorized(request: Request, env: Env) {
  const expected = env.GELD_API_SECRET;
  if (!expected) return false;
  return request.headers.get("x-geld-api-secret") === expected;
}

function containerEnv(env: Env) {
  return {
    NODE_ENV: "production",
    BOT_PORT: "8787",
    LIVE_TRADING: isTrue(env.GELD_LIVE_TRADING) ? "true" : "false",
    AUTO_START: isTrue(env.GELD_AUTO_START) ? "true" : "false",
    MONAD_PRIVATE_KEY: env.MONAD_PRIVATE_KEY ?? "",
    GEMINI_API_KEYS: env.GEMINI_API_KEYS ?? "",
    NADFUN_API_KEY: env.NADFUN_API_KEY ?? "",
    STATE_SYNC_SECRET: env.STATE_SYNC_SECRET ?? "",
    STATE_SYNC_URL: env.STATE_SYNC_URL ?? "",
    MONAD_RPC_URL: env.MONAD_RPC_URL ?? "https://mainnet.monad.xyz/rpc",
    MONAD_WS_URL: env.MONAD_WS_URL ?? ""
  };
}

async function startContainer(env: Env) {
  const container = getContainer(env.GELD_CONTAINER, "singleton");
  await container.startAndWaitForPorts({
    startOptions: {
      envVars: containerEnv(env)
    },
    cancellationOptions: {
      portReadyTimeoutMS: 30000
    }
  });
  return container;
}

export class GeldState extends DurableObject<Env> {
  async fetch(request: Request) {
    const secret = this.env.STATE_SYNC_SECRET;

    if (!secret || request.headers.get("x-geld-state-secret") !== secret) {
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
  entrypoint = ["node", "dist/src/container.js"];
  envVars = {
    NODE_ENV: "production",
    BOT_PORT: "8787"
  };

  override onStart() {
    console.log("geld container started");
  }

  override onStop(params: unknown) {
    console.log("geld container stopped", params);
  }

  override onError(error: unknown) {
    console.error("geld container error", error);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/internal/state/")) {
      const id = env.GELD_STATE.idFromName("singleton");
      const innerPath = url.pathname.replace("/internal/state", "") || "/";
      return env.GELD_STATE.get(id).fetch(
        new Request(new URL(innerPath, url), request)
      );
    }

    if (!isAuthorized(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const container = await startContainer(env);

    return container.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env) {
    try {
      await startContainer(env);
    } catch (error) {
      console.error("scheduled container start failed", error);
    }
  }
};
