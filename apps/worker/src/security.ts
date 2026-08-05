/**
 * The Worker's own security headers.
 *
 * radixia.ai ships a strict, hash-based CSP whose hashes are recomputed from the
 * built pages on every build. This Worker generates HTML that the build never
 * sees, so those hashes can never cover us — we must emit a complete set
 * ourselves, matching the existing site's posture in spirit.
 *
 * As of 2026-08-04 the zone carries no Response Header Transform Rules and all
 * Managed Transforms are disabled, so nothing downstream rewrites what we send.
 * If that ever changes, these assertions are the canary.
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
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
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
