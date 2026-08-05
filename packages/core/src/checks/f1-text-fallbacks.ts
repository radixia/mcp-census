/**
 * F1 — plain-text agent fallbacks: `llms.txt`, `llms-full.txt`, `AGENTS.md`.
 *
 * Community conventions rather than specifications. The main hazard is the
 * soft-404: a great many sites answer `200 OK` with their HTML shell for any
 * unknown path, and counting those would inflate this number badly.
 */

import { TEXT_FALLBACKS } from "../config/candidates.js";
import { headerValue } from "../http/types.js";
import { type CheckContext, type CheckDeps, looksLikeHtml } from "./deps.js";
import { type CheckResult, fail, pass, skip } from "./types.js";

/** Below this, a 200 is a stub or an error page rather than a document. */
const MIN_USEFUL_BYTES = 16;

interface FallbackProbe {
  readonly path: string;
  readonly result:
    | "found"
    | "not_found"
    | "html_catch_all"
    | "empty"
    | "skipped_by_robots"
    | "transport_error"
    | "redirected_off_apex";
  readonly status?: number;
  readonly bytes?: number;
  readonly contentType?: string;
}

export async function checkTextFallbacks(
  deps: CheckDeps,
  _context: CheckContext,
): Promise<CheckResult> {
  const started = deps.now();
  const probes: FallbackProbe[] = [];

  for (const path of TEXT_FALLBACKS) {
    const outcome = await deps.client.fetchPath(path);

    if (outcome.outcome === "skipped_by_robots") {
      probes.push({ path, result: "skipped_by_robots" });
      continue;
    }
    if (outcome.outcome === "transport_error") {
      probes.push({ path, result: "transport_error" });
      continue;
    }
    if (outcome.outcome === "redirect_off_apex") {
      probes.push({ path, result: "redirected_off_apex" });
      continue;
    }

    const { response } = outcome;
    if (response.status < 200 || response.status >= 300) {
      probes.push({ path, result: "not_found", status: response.status });
      continue;
    }

    const contentType = headerValue(response, "content-type");
    const body = response.body.trim();

    if (looksLikeHtml(contentType, response.body)) {
      probes.push({
        path,
        result: "html_catch_all",
        status: response.status,
        ...typed(contentType),
      });
      continue;
    }
    if (body.length < MIN_USEFUL_BYTES) {
      probes.push({ path, result: "empty", status: response.status, bytes: body.length });
      continue;
    }

    probes.push({
      path,
      result: "found",
      status: response.status,
      bytes: body.length,
      ...typed(contentType),
    });
  }

  const latencyMs = deps.now() - started;
  const found = probes.filter((p) => p.result === "found").map((p) => p.path);
  const evidence = { probes, found };

  if (found.length > 0) return pass("F1", evidence, latencyMs);

  if (probes.length > 0 && probes.every((p) => p.result === "skipped_by_robots")) {
    return skip("F1", "skipped_by_robots", latencyMs);
  }

  return fail("F1", evidence, latencyMs);
}

function typed(contentType: string | undefined) {
  return contentType === undefined ? {} : { contentType };
}
