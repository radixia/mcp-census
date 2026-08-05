import type { GuardedHttpClient } from "../http/guarded-client.js";
import type { ResolveTxt } from "../http/types.js";

export interface CheckDeps {
  readonly client: GuardedHttpClient;
  readonly now: () => number;
}

export interface DnsCheckDeps extends CheckDeps {
  readonly resolveTxt: ResolveTxt;
}

export interface CheckContext {
  readonly apex: string;
}

/**
 * Parse a body as a JSON object.
 *
 * Returns undefined for anything that is not an object, including `null`,
 * arrays and JSON scalars — a discovery document that is not an object is not a
 * discovery document, however valid its JSON.
 */
export function parseJsonObject(body: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Does this response look like a catch-all HTML page rather than the document
 * we asked for?
 *
 * Sites that serve a SPA shell or a soft-404 with `200 OK` are the single
 * biggest source of false positives in this kind of measurement, so every check
 * that accepts a 200 has to defend against it.
 */
export function looksLikeHtml(contentType: string | undefined, body: string): boolean {
  if (contentType?.toLowerCase().includes("text/html")) return true;
  const head = body.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head");
}
