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

      // Cap what we read: a discovery document is small, and some of these
      // paths are served by a CDN that will happily stream a huge HTML page.
      const raw = await response.text();
      const body = raw.length > 512 * 1024 ? raw.slice(0, 512 * 1024) : raw;

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
