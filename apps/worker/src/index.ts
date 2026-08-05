import { CENSUS_BASE_PATH, METHODOLOGY_VERSION } from "@mcp-census/core";

import { withSecurityHeaders } from "./security.js";

/**
 * Phase 0 wiring. Real routes land in Phase 6; this exists so the security
 * headers and the canonical-host discipline are under test from the first
 * commit rather than bolted on at the end.
 */
export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith(CENSUS_BASE_PATH)) {
    // Route matching should never send us anything else; if it does, say so
    // rather than silently serving census content on someone else's path.
    return withSecurityHeaders(new Response("not found", { status: 404 }));
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return withSecurityHeaders(new Response("method not allowed", { status: 405 }));
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
};
