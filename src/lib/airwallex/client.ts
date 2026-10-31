import { airwallexBaseUrls, env, type Env } from "../env";

/** Error body shape from the Airwallex API reference. */
export class AirwallexError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly source?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`${status} ${code}: ${message}`);
  }

  /** 429, 5xx and network failures may succeed on retry with the same request_id. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

type FetchFn = typeof fetch;

export interface AirwallexConfig {
  clientId: string;
  apiKey: string;
  apiBase: string;
  filesBase: string;
  fetch?: FetchFn;
  maxRetries?: number;
  /** Injected in tests so backoff does not slow the suite. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Connected account id. Runs the call as that account via x-on-behalf-of. */
  onBehalfOf?: string;
}

/** Re-login this long before the 30 minute token actually expires. */
const TOKEN_SAFETY_MS = 60_000;

export class AirwallexClient {
  private token?: { value: string; expiresAt: number };
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly cfg: AirwallexConfig) {
    this.fetchFn = cfg.fetch ?? fetch;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = cfg.now ?? Date.now;
  }

  private async login(): Promise<string> {
    const res = await this.fetchFn(`${this.cfg.apiBase}/api/v1/authentication/login`, {
      method: "POST",
      headers: { "x-client-id": this.cfg.clientId, "x-api-key": this.cfg.apiKey },
    });
    const body = await parseBody(res);
    if (!res.ok) throw toError(res.status, body);
    const { token, expires_at } = body as { token: string; expires_at: string };
    // expires_at looks like 2021-06-18T16:30:00+0000; normalise the offset for Date.parse.
    const parsed = Date.parse(expires_at.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    const expiresAt = Number.isFinite(parsed) ? parsed : this.now() + 30 * 60_000;
    this.token = { value: token, expiresAt };
    return token;
  }

  private async bearer(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt - TOKEN_SAFETY_MS > this.now()) return this.token.value;
    return this.login();
  }

  async request<T>(method: "GET" | "POST", path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.cfg.apiBase}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    return this.send<T>(url.toString(), method, payload, { "content-type": "application/json" }, opts.onBehalfOf);
  }

  /** Uploads a dispute evidence file to the files host. Returns the file_id. */
  async uploadFile(file: Blob, filename: string, notes?: string): Promise<{ file_id: string }> {
    const form = new FormData();
    form.set("file", file, filename);
    if (notes) form.set("notes", notes.slice(0, 50));
    return this.send(`${this.cfg.filesBase}/api/v1/files/upload`, "POST", form, {});
  }

  private async send<T>(
    url: string,
    method: string,
    body: BodyInit | undefined,
    headers: Record<string, string>,
    onBehalfOf?: string,
  ): Promise<T> {
    const maxRetries = this.cfg.maxRetries ?? 2;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.bearer();
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method,
          body,
          headers: {
            ...headers,
            authorization: `Bearer ${token}`,
            ...(onBehalfOf ? { "x-on-behalf-of": onBehalfOf } : {}),
          },
        });
      } catch (err) {
        const netErr = new AirwallexError(0, "network_error", err instanceof Error ? err.message : String(err));
        if (attempt < maxRetries) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw netErr;
      }
      const parsed = await parseBody(res);
      if (res.ok) return parsed as T;
      const error = toError(res.status, parsed);
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.bearer(true);
        continue;
      }
      if (error.retryable && attempt < maxRetries) {
        await this.sleep(backoff(attempt));
        continue;
      }
      throw error;
    }
  }
}

function backoff(attempt: number) {
  return 250 * 2 ** attempt;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function toError(status: number, body: unknown): AirwallexError {
  const b = (body ?? {}) as { code?: string; message?: string; source?: string; details?: Record<string, unknown> };
  return new AirwallexError(status, b.code ?? "unknown_error", b.message ?? "Request failed", b.source, b.details);
}

/** Returns a client when credentials are configured, otherwise null. */
export function airwallexFromEnv(e: Env = env()): AirwallexClient | null {
  if (!e.AIRWALLEX_CLIENT_ID || !e.AIRWALLEX_API_KEY) return null;
  const bases = airwallexBaseUrls(e);
  return new AirwallexClient({
    clientId: e.AIRWALLEX_CLIENT_ID,
    apiKey: e.AIRWALLEX_API_KEY,
    apiBase: bases.api,
    filesBase: bases.files,
  });
}
