import { CENSUS_BASE_PATH, METHODOLOGY_VERSION } from "@mcp-census/core";

import { consume, scheduled } from "./crawl.js";
import type { CrawlMessage, Env } from "./env.js";
import { withSecurityHeaders } from "./security.js";

/**
 * HTTP routes land in Phase 6. This exists so the security headers and the
 * canonical-host discipline are under test from the first commit rather than
 * bolted on at the end.
 *
 * Note the Workers route is still commented out in wrangler.jsonc: the Worker
 * is deployed but nothing on www.radixia.ai reaches it yet.
 */
export async function handle(request: Request, env?: Env): Promise<Response> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith(CENSUS_BASE_PATH)) {
    // Route matching should never send us anything else; if it does, say so
    // rather than silently serving census content on someone else's path.
    return withSecurityHeaders(new Response("not found", { status: 404 }));
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return withSecurityHeaders(new Response("method not allowed", { status: 405 }));
  }

  // A liveness probe that also proves the D1 binding works, which is the one
  // thing a deploy can silently get wrong.
  if (url.pathname === `${CENSUS_BASE_PATH}/health` && env?.DB !== undefined) {
    const runs = await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs`).first<{ n: number }>();
    const scans = await env.DB.prepare(`SELECT COUNT(*) AS n FROM scans`).first<{ n: number }>();
    return withSecurityHeaders(
      new Response(
        JSON.stringify(
          { status: "ok", methodologyVersion: METHODOLOGY_VERSION, runs: runs?.n, scans: scans?.n },
          null,
          2,
        ),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
      ),
    );
  }

  return withSecurityHeaders(
    new Response(
      JSON.stringify({ status: "scaffold", methodologyVersion: METHODOLOGY_VERSION }, null, 2),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    ),
  );
}

export default {
  fetch: handle,
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(event, env));
  },
  queue: (batch: MessageBatch<CrawlMessage>, env: Env) => consume(batch, env),
};
