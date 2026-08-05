/**
 * The Worker's own security headers.
 *
 * radixia.ai ships a strict, hash-based CSP whose hashes are recomputed from the
 * built pages on every build. This Worker generates HTML that the build never
 * sees, so those hashes can never cover us — we must emit a complete set
 * ourselves, matching the existing site's posture in spirit.
 *
 * This file used to claim that nothing downstream rewrites what we send. That was
 * true of Transform Rules and is not true in general: **HSTS is governed at the
 * zone**, under SSL/TLS → Edge Certificates, and the zone's setting wins over
 * whatever the origin emits. Observed on 2026-08-05, the Worker sent
 * `max-age=31536000; includeSubDomains; preload` and the client received the same
 * value with `preload` stripped.
 *
 * So what this file sends has to match the zone's configuration. A mismatch is
 * invisible until somebody diffs the wire against the source, and a header that
 * silently does not mean what the code says is worse than one that is absent.
 *
 * `preload` is deliberately gone, by Marco's decision, now and at launch. Entry
 * into the browser preload list is easy to obtain and effectively irreversible,
 * and it commits every present and future subdomain of radixia.ai — including ones
 * nobody has thought of yet.
 */

import { NOINDEX_HEADER, SEARCH_INDEXING_ENABLED } from "@mcp-census/core";

/**
 * Deliberately allows no inline script and no inline stylesheet.
 *
 * The site is server-rendered with inline `<svg>` elements for charts, which are
 * markup rather than images and so are not constrained by `img-src`. That keeps
 * `default-src 'none'` viable and means no `unsafe-inline` anywhere.
 */
const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'none'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "form-action": ["'self'"],
  "base-uri": ["'none'"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
};

export function contentSecurityPolicy(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": contentSecurityPolicy(),
  // No `preload`: see the docblock. The zone would strip it anyway, so sending it
  // only created a gap between the source and the wire.
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "x-frame-options": "DENY",
};

/**
 * Apply the full set to a response without clobbering its existing headers.
 *
 * Also applies `X-Robots-Tag` while `SEARCH_INDEXING_ENABLED` is false. Doing it
 * here rather than per route means it covers every response — pages, the
 * stylesheet, badge SVGs, 404s — with no way to add a route that forgets it.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  if (!SEARCH_INDEXING_ENABLED) headers.set("x-robots-tag", NOINDEX_HEADER);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
