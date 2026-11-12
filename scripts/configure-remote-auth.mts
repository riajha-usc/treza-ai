/**
 * Registers Treza's remote authorization endpoint with Airwallex Issuing and
 * saves the shared secret Airwallex returns to a local, gitignored file.
 * Sandbox only. The secret is printed nowhere; copy it from the file into
 * `bash deploy/secret.sh AIRWALLEX_REMOTE_AUTH_SECRET`, then deploy.
 *
 *   node --env-file=.env --import tsx scripts/configure-remote-auth.mts https://your.host/api/airwallex/remote-auth
 *   node --env-file=.env --import tsx scripts/configure-remote-auth.mts --show      (current settings, no secret)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { airwallexFromEnv } from "../src/lib/airwallex/client";

type Settings = {
  remote_auth_settings?: { enabled: boolean; url?: string; default_action?: string; version?: number; shared_secret?: string | null; updated_at?: string };
};

const arg = process.argv[2];
const client = airwallexFromEnv();
if (!client) throw new Error("AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY are needed in .env");

const describe = (s: Settings["remote_auth_settings"]) =>
  s ? `enabled=${s.enabled} url=${s.url ?? "none"} default=${s.default_action ?? "none"} version=${s.version ?? "none"} updated=${s.updated_at ?? "never"}` : "not configured";

const before = await client.request<Settings>("GET", "/api/v1/issuing/config");
console.log(`Before: ${describe(before.remote_auth_settings)}`);
if (!arg || arg === "--show") process.exit(0);
// Registering leaves the feature off so no charge is declined before the secret is deployed; --enable turns it on.
if (arg === "--disable" || arg === "--enable") {
  const r = await client.request<Settings>("POST", "/api/v1/issuing/config/update", { body: { remote_auth: { enabled: arg === "--enable" } } });
  console.log(`After:  ${describe(r.remote_auth_settings)}`);
  process.exit(0);
}
if (!arg.startsWith("https://")) throw new Error("The endpoint must be an https URL, or --show, --enable, --disable");

const after = await client.request<Settings>("POST", "/api/v1/issuing/config/update", {
  body: { remote_auth: { enabled: false, url: arg, default_action: "DECLINED", version: 2, new_shared_secret: true } },
});
const s = after.remote_auth_settings;
console.log(`After:  ${describe(s)}`);
if (!s?.shared_secret) {
  console.log("Airwallex returned no shared secret this time. Run again with new_shared_secret if you need a fresh one.");
  process.exit(0);
}
mkdirSync("secrets", { recursive: true });
const file = "secrets/airwallex-remote-auth-secret.txt";
writeFileSync(file, s.shared_secret, { mode: 0o600 });
console.log(`Shared secret saved to ${file} (${s.shared_secret.length} characters). Store it with: bash deploy/secret.sh AIRWALLEX_REMOTE_AUTH_SECRET`);
