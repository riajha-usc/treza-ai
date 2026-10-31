import { z } from "zod";

/**
 * Runtime configuration. Every integration is optional at boot so the app
 * can start, seed and show a setup checklist before keys are added.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  PGLITE_DIR: z.string().default(".data/treza"),

  AIRWALLEX_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  AIRWALLEX_CLIENT_ID: z.string().min(1).optional(),
  AIRWALLEX_API_KEY: z.string().min(1).optional(),
  AIRWALLEX_WEBHOOK_SECRET: z.string().min(1).optional(),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  BEDROCK_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

/** Test helper: forget cached config so tests can change process.env. */
export function resetEnvForTests() {
  cached = undefined;
}

export function airwallexBaseUrls(e: Env = env()) {
  return e.AIRWALLEX_ENV === "production"
    ? { api: "https://api.airwallex.com", files: "https://files.airwallex.com" }
    : { api: "https://api.sandbox.airwallex.com", files: "https://files.sandbox.airwallex.com" };
}
