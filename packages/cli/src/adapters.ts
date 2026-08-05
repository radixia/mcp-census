/**
 * Node implementations of the two seams `packages/core` leaves open.
 *
 * Identical in behaviour to the pilot runner's adapters and the Worker's, so
 * `npx mcpcensus check` reports exactly what the census reports. If these three
 * ever diverge, the CLI stops being a way to verify a published row.
 */

import { Resolver } from "node:dns/promises";
import type { HttpFetch, ResolveTxt } from "@mcp-census/core";

const MAX_BODY_BYTES = 512 * 1024;

export function nodeFetch(): HttpFetch {
  return async (request, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      // `redirect: "manual"` is load-bearing: core decides whether a redirect
      // may be followed, and letting undici follow them would take us off the
      // target apex without the guard ever seeing it.
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

      return {
        status: response.status,
        headers,
        body: await readBody(response, options.idleTimeoutMs),
        url: response.url || request.url,
      };
    } catch (error) {
      throw new Error(errorCode(error), { cause: error });
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Stop reading once the stream goes quiet rather than when it closes. An SSE
 * response delivers its reply and then stays open, so waiting for close spends
 * the whole timeout on a server that already answered.
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

      if (outcome === "idle" || outcome.done) break;

      body += decoder.decode(outcome.value, { stream: true });
      if (body.length >= MAX_BODY_BYTES) return body.slice(0, MAX_BODY_BYTES);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return body;
}

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause as { code?: string } | undefined;
    if (cause?.code !== undefined) return `${cause.code}: ${error.message}`;
    if (error.name === "AbortError" || error.name === "TimeoutError") return "ETIMEDOUT: timeout";
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
