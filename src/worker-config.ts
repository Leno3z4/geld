export interface WorkerAutoStartEnv {
  GELD_CONFIG?: string;
  GELD_AUTO_START?: string;
}

export function parseGeldConfig(raw?: string): Record<string, string | undefined> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("GELD_CONFIG must be a JSON object");
    }

    const config: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      config[key] = typeof value === "string" ? value : String(value);
    }
    return config;
  } catch (error) {
    console.error("Invalid GELD_CONFIG:", error);
    return {};
  }
}

function isTrue(value?: string) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function autoStartEnabled(env: WorkerAutoStartEnv) {
  const embeddedConfig = parseGeldConfig(env.GELD_CONFIG);
  const value = embeddedConfig.GELD_AUTO_START ?? env.GELD_AUTO_START;
  return isTrue(value);
}
