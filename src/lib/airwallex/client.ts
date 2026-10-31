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

