/**
 * Transport interfaces.
 *
 * `packages/core` performs no I/O of its own: every probe is handed a fetch
 * implementation. That is what lets the same probe code run in the CLI, in a
 * Worker and in a local pilot script, and lets fixture tests exercise the real
 * decision logic without a network.
 */

export type SafeHttpMethod = "GET" | "HEAD";
export type HttpMethod = SafeHttpMethod | "POST";

export interface HttpRequest {
  readonly url: string;
  readonly method: HttpMethod;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  /** Lower-cased header names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Final URL after any redirect, so callers can detect where they landed. */
  readonly url: string;
}

export interface FetchOptions {
  readonly timeoutMs: number;
  /**
   * Stop reading the body once it has been quiet for this long, even if the
   * stream is still open.
   *
   * An SSE response delivers the JSON-RPC reply and then *stays open* — the
   * transport keeps the stream alive for request-scoped notifications, and
   * long-lived streams are even encouraged to emit keep-alive comments. Waiting
   * for the stream to close therefore burns the whole timeout on a server that
   * answered immediately, and reports it as unreachable.
   *
   * Observed on our own server: `initialize` replied at once but the request
   * took 10.9s to complete, over the 10s ceiling. Every SSE-based MCP server
   * would have been recorded as dead.
   */
  readonly idleTimeoutMs?: number;
}

/**
 * The single seam between our logic and the network.
 *
 * Implementations must **not** follow redirects automatically: redirect
 * decisions run through `assertRedirectAllowed`, and a client that follows them
 * silently would take us off the target apex without the guard ever seeing it.
 */
export type HttpFetch = (request: HttpRequest, options: FetchOptions) => Promise<HttpResponse>;

/** DNS TXT lookup for D2. Node uses `dns/promises`; a Worker would use DoH. */
export type ResolveTxt = (name: string) => Promise<string[][]>;

export function headerValue(response: HttpResponse, name: string): string | undefined {
  return response.headers[name.toLowerCase()];
}

/** A body we are willing to parse. Guards against a multi-megabyte HTML page. */
export const MAX_PARSEABLE_BODY_BYTES = 512 * 1024;

export function looksLikeJson(response: HttpResponse): boolean {
  const contentType = headerValue(response, "content-type") ?? "";
  return contentType.includes("json");
}
