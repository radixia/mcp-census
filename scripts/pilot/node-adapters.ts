/**
 * Node implementations of the two seams `packages/core` leaves open.
 *
 * All the policy — what may be fetched, how often, with which headers — lives
 * in core. These adapters only move bytes.
 */

import { Resolver } from "node:dns/promises";
import type { HttpFetch, ResolveTxt } from "@mcp-census/core";

/**
 * `redirect: "manual"` is load-bearing. Core decides whether a redirect may be
 * followed; letting undici follow them silently would take us off the target
 * apex without the guard ever seeing it.
 */
export function nodeFetch(): HttpFetch {
  return async (request, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "manual",
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });

      const body = await readBody(response, options.idleTimeoutMs);
      return { status: response.status, headers, body, url: response.url || request.url };
    } catch (error) {
      // undici reports everything as `TypeError: fetch failed` and hides the
      // real reason in `cause`. Core needs the code to tell a deterministic
      // "this host does not exist" from a transient failure worth retrying.
      throw new Error(errorCode(error), { cause: error });
    } finally {
      clearTimeout(timer);
    }
  };
}

/** A discovery document is small; some of these paths are served by a CDN that
 *  will happily stream a huge HTML page. */
const MAX_BODY_BYTES = 512 * 1024;

/**
 * Read a response body, stopping when the stream goes quiet rather than when it
 * closes.
 *
 * SSE responses deliver the JSON-RPC reply and then stay open — the transport
 * keeps the stream alive for request-scoped notifications and encourages
 * keep-alive comments on long-lived ones. `response.text()` waits for close, so
 * a server that answered instantly consumed the entire timeout and was recorded
 * as unreachable. Measured on our own server: `initialize` replied at once, the
 * request took 10.9s, the 10s ceiling killed it.
 *
 * With no idle timeout this behaves exactly as before.
 */
async function readBody(response: Response, idleTimeoutMs?: number): Promise<string> {
  if (idleTimeoutMs === undefined || response.body === null) {
    const raw = await response.text();
    return raw.length > MAX_BODY_BYTES ? raw.slice(0, MAX_BODY_BYTES) : raw;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";

  try {
    while (true) {
      let idle: ReturnType<typeof setTimeout> | undefined;
      const quiet = new Promise<"idle">((resolve) => {
        idle = setTimeout(() => resolve("idle"), idleTimeoutMs);
      });

      let outcome: "idle" | Awaited<ReturnType<typeof reader.read>>;
      try {
        outcome = await Promise.race([reader.read(), quiet]);
      } finally {
        if (idle !== undefined) clearTimeout(idle);
      }

      // Quiet for long enough that the server has said what it is going to say.
      if (outcome === "idle") break;
      if (outcome.done) break;

      body += decoder.decode(outcome.value, { stream: true });
      if (body.length >= MAX_BODY_BYTES) return body.slice(0, MAX_BODY_BYTES);
    }
  } finally {
    // Closing our end is the cancellation signal the transport defines, so this
    // also tells the server to stop working on our behalf.
    await reader.cancel().catch(() => {});
  }

  return body;
}

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause as { code?: string; message?: string } | undefined;
    const code = cause?.code;
    if (code !== undefined) return `${code}: ${error.message}`;
    if (error.name === "AbortError" || error.name === "TimeoutError") return `ETIMEDOUT: timeout`;
    return error.message;
  }
  return String(error);
}

export function nodeResolveTxt(timeoutMs = 5000): ResolveTxt {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  return async (name) => resolver.resolveTxt(name);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
