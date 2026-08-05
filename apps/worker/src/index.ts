import { CENSUS_BASE_PATH, censusUrl, METHODOLOGY_VERSION } from "@mcp-census/core";

import { consume, scheduled } from "./crawl.js";
import type { CrawlMessage, Env } from "./env.js";
import { route } from "./router.js";
import { withSecurityHeaders } from "./security.js";

/**
 * The Worker's front door. **Live** since 2026-08-05, serving
 * `www.radixia.ai/census/*` on a zone route.
 *
 * Four things happen here, in order, before anything reaches the router:
 *
 *  1. **Prefix guard.** Route matching should only ever send us `/census`, so
 *     anything else is answered `404` rather than silently serving census content
 *     on somebody else's path.
 *  2. **Trailing-slash redirect.** `/census` is what people type and share, so it
 *     has its own route pattern — but it redirects instead of serving, so the
 *     landing page keeps exactly one address.
 *  3. **Method allowlist.** `GET` and `HEAD` only. Nothing here mutates anything,
 *     and the one `POST` this project makes is the crawler's, not a visitor's.
 *  4. **No-bindings branch.** Reachable only from a unit test, which constructs a
 *     request without an `Env`. It exists so the header discipline is testable
 *     without D1.
 *
 * Every return goes through `withSecurityHeaders`, including the redirect and both
 * error paths, so no route can be added that forgets them — `X-Robots-Tag`
 * included, while search indexing is off.
 */
export async function handle(request: Request, env?: Env): Promise<Response> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith(CENSUS_BASE_PATH)) {
    // Route matching should never send us anything else; if it does, say so
    // rather than silently serving census content on someone else's path.
    return withSecurityHeaders(new Response("not found", { status: 404 }));
  }

  // `/census` with no trailing slash is a real entry point — nobody types, prints,
  // speaks or tweets a URL ending in a slash — but it must not become a second URL
  // for the landing page. Redirect rather than serve, so every page has exactly one
  // canonical address.
  //
  // Exact equality, not `startsWith`, so a hypothetical `/censusfoo` still falls to
  // the guard above. Built with the constructor rather than `Response.redirect`,
  // whose result has immutable headers that `withSecurityHeaders` would have to
  // fight to decorate.
  if (url.pathname === CENSUS_BASE_PATH) {
    return withSecurityHeaders(
      new Response(null, { status: 301, headers: { location: censusUrl("/") } }),
    );
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return withSecurityHeaders(new Response("method not allowed", { status: 405 }));
  }

  // Without bindings there is nothing to serve. Only reachable in a unit test.
  if (env?.DB === undefined) {
    return withSecurityHeaders(
      new Response(
        JSON.stringify({ status: "no-bindings", methodologyVersion: METHODOLOGY_VERSION }, null, 2),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
      ),
    );
  }

  return withSecurityHeaders(await route(request, env));
}

export default {
  fetch: handle,
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(event, env));
  },
  queue: (batch: MessageBatch<CrawlMessage>, env: Env) => consume(batch, env),
};
