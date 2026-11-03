import { z } from "zod";

/** A blank value such as DATABASE_URL= in an env file means "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

/**
 * Runtime configuration. Every integration is optional at boot so the app
 * can start, seed and show a setup checklist before keys are added.
 */
const EnvSchema = z.object({
  DATABASE_URL: optional(z.string().url()),
  PGLITE_DIR: z.string().default(".data/treza"),

  AIRWALLEX_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  AIRWALLEX_CLIENT_ID: optional(z.string().min(1)),
  AIRWALLEX_API_KEY: optional(z.string().min(1)),
  AIRWALLEX_WEBHOOK_SECRET: optional(z.string().min(1)),
  /** Shared secret Airwallex returns when remote authorization is configured. */
  AIRWALLEX_REMOTE_AUTH_SECRET: optional(z.string().min(1)),

  ANTHROPIC_API_KEY: optional(z.string().min(1)),
  AWS_REGION: optional(z.string().min(1)),
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
