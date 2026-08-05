/**
 * Turning a probe result into something a person wants to read.
 *
 * The output is the thing someone screenshots and posts, so it has to be
 * legible in a terminal with no colour support and it has to be honest: a
 * domain we were not allowed to measure is never shown as a zero.
 */

import type { CheckId, CheckResult, DomainProbeResult } from "@mcp-census/core";

const CHECK_NAMES: Record<CheckId, string> = {
  D1: "Server card",
  D2: "DNS discovery",
  D3: "Conventional endpoint",
  D4: "OAuth protected resource",
  D5: "Handshake",
  D6: "Tool listing",
  Q1: "Tool surface quality",
  F1: "Text fallbacks",
  F2: "AI crawler posture",
  S1: "Shadow MCP",
};

const MARK: Record<string, string> = { pass: "PASS", fail: "----", skip: "skip", error: "ERR " };

/** Colour only when the terminal is one, so piping to a file stays clean. */
function paint(enabled: boolean, code: string, text: string): string {
  return enabled ? `[${code}m${text}[0m` : text;
}

export interface ReportOptions {
  readonly all: boolean;
  readonly colour: boolean;
}

export function humanReport(result: DomainProbeResult, options: ReportOptions): string {
  const c = options.colour;
  const lines: string[] = [];
  const score = result.score;

  lines.push("");
  lines.push(`  ${paint(c, "1", result.apex)}`);

  if (score.assessed) {
    const band =
      score.score >= 70
        ? paint(c, "32", score.band)
        : score.score >= 31
          ? paint(c, "33", score.band)
          : paint(c, "31", score.band);
    lines.push(`  ${paint(c, "1", `${score.score}/100`)}  ${band}`);
  } else {
    lines.push(`  ${paint(c, "33", "not assessable")}  ${score.reason}`);
    lines.push("");
    lines.push(
      score.reason === "skipped_by_robots"
        ? "  Your robots.txt excludes our crawler, so we did not look. That is a fact"
        : "  We could not reach this domain, so we learned nothing about it.",
    );
    if (score.reason === "skipped_by_robots")
      lines.push("  about our crawl, not a finding about your site.");
  }

  lines.push("");

  for (const check of result.checks) {
    const mark =
      check.status === "pass"
        ? paint(c, "32", MARK.pass as string)
        : check.status === "fail"
          ? paint(c, "31", MARK.fail as string)
          : paint(c, "90", (MARK[check.status] ?? "?") as string);

    const detail = detailOf(check);
    lines.push(
      `  ${mark}  ${check.id.padEnd(3)} ${(CHECK_NAMES[check.id] ?? check.id).padEnd(26)}${detail}`,
    );

    if (options.all) {
      for (const line of evidenceLines(check)) lines.push(`         ${paint(c, "90", line)}`);
    }
  }

  const fixes = fixesFor(result.checks);
  if (fixes.length > 0) {
    lines.push("");
    lines.push(`  ${paint(c, "1", "What to fix first")}`);
    for (const [i, fix] of fixes.entries()) lines.push(`  ${i + 1}. ${fix}`);
  }

  lines.push("");
  lines.push(
    paint(
      c,
      "90",
      `  ${result.requestCount} requests, ${Math.round(result.durationMs / 1000)}s, methodology ${result.methodologyVersion}`,
    ),
  );
  lines.push(paint(c, "90", "  https://www.radixia.ai/census/methodology"));
  lines.push("");

  return lines.join("\n");
}

function detailOf(check: CheckResult): string {
  const e = check.evidence as Record<string, unknown>;

  if (typeof e.skipReason === "string") return e.skipReason;

  if (check.id === "D1" && Array.isArray(e.respondedWith) && e.respondedWith.length > 0) {
    return (e.respondedWith as string[]).join(", ");
  }
  if (check.id === "D3" && typeof e.endpointUrl === "string") return e.endpointUrl;
  if (check.id === "D5") {
    if (e.requiresAuthorization === true) return "requires authorization";
    if (typeof e.era === "string") return `${e.era} era`;
  }
  if (check.id === "D6" && typeof e.toolCount === "number") return `${e.toolCount} tools`;
  if (check.id === "Q1" && typeof e.parameterCoverage === "number") {
    return `${Math.round(e.parameterCoverage * 100)}% of parameters documented`;
  }
  if (check.id === "F1" && Array.isArray(e.found) && e.found.length > 0) {
    return (e.found as string[]).join(", ");
  }
  if (check.id === "F2" && typeof e.declaredCount === "number") {
    return `${e.declaredCount} agents named`;
  }
  return "";
}

function evidenceLines(check: CheckResult): string[] {
  return JSON.stringify(check.evidence, null, 1)
    .split("\n")
    .slice(0, 40)
    .map((l) => l.trimEnd());
}

/** Same ranking the website uses, so the advice does not contradict itself. */
export function fixesFor(checks: readonly CheckResult[]): string[] {
  const status = (id: CheckId) => checks.find((c) => c.id === id)?.status;
  const fixes: string[] = [];

  if (status("D1") !== "pass") {
    fixes.push(
      "Publish a server card at /.well-known/ai-catalog.json — the location the current proposal defers to.",
    );
  }
  if (status("D5") !== "pass" && status("D3") !== "pass") {
    fixes.push("Serve your MCP endpoint at /mcp or on mcp.<yourdomain> so an agent can guess it.");
  }
  if (status("F1") !== "pass") {
    fixes.push("Add an llms.txt — the cheapest item here and the most widely read today.");
  }
  if (status("F2") !== "pass") {
    fixes.push("State an AI crawler policy in robots.txt. Either answer counts; silence does not.");
  }
  if (status("Q1") === "fail") {
    fixes.push("Describe every tool and every parameter — an undescribed tool cannot be chosen.");
  }

  return fixes.slice(0, 3);
}

export function jsonReport(result: DomainProbeResult): string {
  return JSON.stringify(result, null, 2);
}
