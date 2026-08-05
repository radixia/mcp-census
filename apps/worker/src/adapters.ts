/**
 * Workers implementations of the two seams `packages/core` leaves open.
 *
 * Same contract as the Node adapters in `scripts/pilot`, so the probe that
 * produced the pilot numbers is byte-for-byte the probe that runs in production.
 * All the policy lives in core; these only move bytes.
 */

import type { HttpFetch, ResolveTxt } from "@mcp-census/core";

const MAX_BODY_BYTES = 512 * 1024;

/**
 * `redirect: "manual"` is load-bearing: core decides whether a redirect may be
 * followed, and letting the runtime follow them would take us off the target
 * apex without the guard ever seeing it.
 */
export function workerFetch(): HttpFetch {
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
      throw new Error(errorCode(error), { cause: error });
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Stop reading once the stream goes quiet rather than when it closes.
 *
 * An SSE response delivers its JSON-RPC reply and then stays open. Waiting for
 * close burns the whole timeout on a server that already answered — measured at
 * 10.9s against a server that replied instantly.
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

      if (outcome === "idle") break;
      if (outcome.done) break;

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

/**
 * DNS over HTTPS. Workers has no DNS resolver, so D2 goes through Cloudflare's
 * public resolver — a plain unauthenticated read of a public record, same as
 * every other probe.
 */
export function dohResolveTxt(): ResolveTxt {
  return async (name) => {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", name);
    url.searchParams.set("type", "TXT");

    const response = await fetch(url, { headers: { accept: "application/dns-json" } });
    if (!response.ok) throw new Error(`ESERVFAIL: DoH ${response.status}`);

    const body = (await response.json()) as { Status?: number; Answer?: Array<{ data?: string }> };

    // NXDOMAIN. A clean negative, and the caller distinguishes it from a
    // resolver failure by the message.
    if (body.Status === 3) throw new Error("ENOTFOUND: NXDOMAIN");
    if (body.Answer === undefined) throw new Error("ENODATA: no TXT record");

    // DoH returns each record already joined, quoted. Strip the quoting and
    // present it as a single chunk, matching the Node resolver's shape.
    return body.Answer.filter((a) => typeof a.data === "string").map((a) => [
      (a.data as string).replace(/^"|"$/g, "").replaceAll('" "', ""),
    ]);
  };
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
