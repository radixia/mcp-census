/**
 * Phase 1 pilot runner.
 *
 * Probes a list of domains and writes one CSV row per domain plus a JSON
 * artifact per domain. Deliberately a plain Node script with no Cloudflare
 * dependencies: the go/no-go has to be reachable before any infrastructure
 * exists.
 *
 *   pnpm pilot --input <file> [--limit N] [--concurrency N] [--out DIR]
 *   pnpm pilot --domains www.radixia.ai,example.com
 *
 * Concurrency is *across* domains. Within a domain the probe is sequential and
 * rate-limited by core, so raising this never speeds up any single site.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  type DomainProbeResult,
  GuardedHttpClient,
  POLITENESS,
  ProbeGuardError,
  probeDomain,
  resolveCrawlerIdentity,
} from "@mcp-census/core";

import { nodeFetch, nodeResolveTxt, sleep } from "./node-adapters.ts";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    domains: { type: "string" },
    limit: { type: "string" },
    concurrency: { type: "string" },
    out: { type: "string", default: "out/pilot" },
    optouts: { type: "string", default: "data/optouts.txt" },
    // Skip apexes already present in the out dir's results.jsonl. The JSONL is
    // the authoritative cumulative record; the CSV and summary a resumed run
    // writes cover only that run's freshly-probed rows.
    resume: { type: "boolean", default: false },
  },
  // pnpm can forward a bare `--`; tolerate it rather than crashing on it.
  allowPositionals: true,
});

async function loadOptOuts(path: string): Promise<Set<string>> {
  try {
    const text = await readFile(path, "utf8");
    return new Set(
      text
        .split("\n")
        .map((line) => line.replace(/#.*$/, "").trim().toLowerCase())
        .filter((line) => line !== ""),
    );
  } catch {
    return new Set();
  }
}

async function loadDomains(): Promise<string[]> {
  if (values.domains !== undefined) {
    return values.domains
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
  }
  if (values.input === undefined) {
    throw new Error("pass --input <file> or --domains a.com,b.com");
  }

  const text = await readFile(values.input, "utf8");
  const domains = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  const limit = values.limit === undefined ? undefined : Number.parseInt(values.limit, 10);
  return limit === undefined ? domains : domains.slice(0, limit);
}

interface Row {
  readonly apex: string;
  readonly result?: DomainProbeResult;
  readonly guardViolation?: string;
  readonly crashed?: string;
}

async function probeOne(apex: string, optOuts: Set<string>): Promise<Row> {
  const deps = { fetch: nodeFetch(), sleep, now: () => Date.now() };

  try {
    const client = new GuardedHttpClient(deps, {
      apex,
      identity: resolveCrawlerIdentity(),
      optOuts,
    });
    const result = await probeDomain(
      { client, now: () => Date.now(), resolveTxt: nodeResolveTxt() },
      { apex },
    );
    return { apex, result };
  } catch (error) {
    // A guard violation is a bug in our probe, not a fact about the domain. It
    // must be impossible to miss in the output.
    if (error instanceof ProbeGuardError) {
      return { apex, guardViolation: `${error.rule}: ${error.message}` };
    }
    return { apex, crashed: error instanceof Error ? error.message : String(error) };
  }
}

/** A fixed-size worker pool. Domains are independent; sites are not. */
async function pool<T, R>(
  items: readonly T[],
  size: number,
  worker: (item: T, index: number) => Promise<R>,
  onDone: (result: R, completed: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let completed = 0;

  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const index = next++;
      const item = items[index];
      if (item === undefined) return;
      const result = await worker(item, index);
      results[index] = result;
      onDone(result, ++completed);
    }
  });

  await Promise.all(runners);
  return results;
}

function statusOf(row: Row, id: string): string {
  if (row.guardViolation !== undefined) return "GUARD";
  if (row.crashed !== undefined) return "crash";
  return row.result?.checks.find((c) => c.id === id)?.status ?? "";
}

/** Which D1 candidates responded, so the distribution is in the CSV itself. */
function respondedCandidates(row: Row): string {
  const d1 = row.result?.checks.find((c) => c.id === "D1");
  const responded = (d1?.evidence as { respondedWith?: string[] } | undefined)?.respondedWith;
  return responded?.join("|") ?? "";
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function toCsv(rows: readonly Row[]): string {
  const header = [
    "apex",
    "score",
    "band",
    "assessed",
    "D1",
    "D2",
    "D3",
    "D4",
    "F1",
    "F2",
    "d1_responded",
    "requests",
    "duration_ms",
    "methodology_version",
    "note",
  ];

  const lines = rows.map((row) => {
    const score = row.result?.score;
    return [
      row.apex,
      score?.assessed ? String(score.score) : "",
      score?.assessed ? score.band : "",
      score === undefined ? "" : score.assessed ? "yes" : score.reason,
      statusOf(row, "D1"),
      statusOf(row, "D2"),
      statusOf(row, "D3"),
      statusOf(row, "D4"),
      statusOf(row, "F1"),
      statusOf(row, "F2"),
      respondedCandidates(row),
      String(row.result?.requestCount ?? 0),
      String(row.result?.durationMs ?? 0),
      row.result?.methodologyVersion ?? "",
      row.guardViolation ?? row.crashed ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });

  return [header.join(","), ...lines].join("\n");
}

/**
 * Every check the summary reports, in the order the methodology lists them.
 *
 * Was written out twice as a literal covering D1-D4, F1, F2, and stayed that way
 * when D5, D6 and Q1 were added — so the local summary silently omitted the
 * handshake, the tool listing and the tool-surface check, the three that carry
 * the headline. One list, used in both places, cannot drift like that again.
 */
const SUMMARY_CHECKS = ["D1", "D2", "D3", "D4", "D5", "D6", "Q1", "F1", "F2"] as const;

function summarise(rows: readonly Row[]): string {
  const total = rows.length;
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

  const candidateHits = new Map<string, number>();
  let assessed = 0;
  let blocked = 0;
  let unreachable = 0;
  let guardViolations = 0;

  for (const row of rows) {
    if (row.guardViolation !== undefined) guardViolations++;

    for (const id of SUMMARY_CHECKS) {
      const status = statusOf(row, id);
      if (status === "pass") bump(id);
    }

    const responded = respondedCandidates(row);
    if (responded !== "") {
      for (const candidate of responded.split("|")) {
        candidateHits.set(candidate, (candidateHits.get(candidate) ?? 0) + 1);
      }
    }

    const score = row.result?.score;
    if (score?.assessed) assessed++;
    else if (score?.reason === "skipped_by_robots") blocked++;
    else unreachable++;
  }

  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
  const lines = [
    "",
    `Domains probed:        ${total}`,
    `Assessed:              ${assessed} (${pct(assessed)})`,
    `Blocked by robots:     ${blocked} (${pct(blocked)})`,
    `Unreachable / error:   ${unreachable} (${pct(unreachable)})`,
    "",
    "Check pass rates:",
  ];

  for (const id of SUMMARY_CHECKS) {
    const n = counts.get(id) ?? 0;
    lines.push(`  ${id}  ${String(n).padStart(4)}  ${pct(n)}`);
  }

  lines.push("", "Which discovery mechanism responded:");
  if (candidateHits.size === 0) {
    lines.push("  (none)");
  } else {
    for (const [candidate, n] of [...candidateHits].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${candidate.padEnd(38)} ${String(n).padStart(4)}`);
    }
  }

  if (guardViolations > 0) {
    lines.push("", `!! GUARD VIOLATIONS: ${guardViolations} — investigate before any further run`);
  }

  return lines.join("\n");
}

/**
 * Resolve concurrency: default to the published cap, and never exceed it. The
 * ethics document names a number; the runner must not quietly beat it.
 */
function resolveConcurrency(): number {
  const cap = POLITENESS.maxGlobalConcurrency;
  const requested =
    values.concurrency === undefined ? cap : Number.parseInt(values.concurrency, 10);
  if (!Number.isFinite(requested) || requested < 1) return cap;
  return Math.min(requested, cap);
}

/** Apexes already recorded in a prior run's JSONL, so a resumed run skips them. */
async function loadDone(path: string): Promise<Set<string>> {
  try {
    const text = await readFile(path, "utf8");
    const done = new Set<string>();
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const apex = (JSON.parse(line) as { apex?: string }).apex;
        if (apex !== undefined) done.add(apex);
      } catch {
        // A torn final line from a hard kill. Skip it; the domain re-runs.
      }
    }
    return done;
  } catch {
    return new Set();
  }
}

async function main(): Promise<void> {
  const allDomains = await loadDomains();
  const optOuts = await loadOptOuts(values.optouts as string);
  const concurrency = resolveConcurrency();
  const outDir = values.out as string;

  await mkdir(outDir, { recursive: true });

  // Every completed domain is appended here immediately, so a crash at domain
  // 480 does not lose the first 479 — and --resume picks up where it stopped.
  const jsonlPath = join(outDir, "results.jsonl");
  const done = values.resume === true ? await loadDone(jsonlPath) : new Set<string>();
  const domains = allDomains.filter((d) => !done.has(d));

  // Fails loudly if the opt-out contact was ever reset to a placeholder.
  const identity = resolveCrawlerIdentity();

  process.stderr.write(`${identity.userAgent}\n`);
  const resumeNote = done.size > 0 ? `, resuming (${done.size} already done)` : "";
  process.stderr.write(
    `probing ${domains.length} domains, concurrency ${concurrency}, opt-outs ${optOuts.size}${resumeNote}\n\n`,
  );

  const started = Date.now();
  const rows = await pool(
    domains,
    concurrency,
    (apex) => probeOne(apex, optOuts),
    (row, completed) => {
      // Append-only, one JSON object per line, flushed as each domain finishes.
      void appendFile(jsonlPath, `${JSON.stringify(row.result ?? row)}\n`, "utf8");

      const score = row.result?.score;
      const verdict = row.guardViolation
        ? "GUARD VIOLATION"
        : score?.assessed
          ? `${score.score} ${score.band}`
          : (score?.reason ?? row.crashed ?? "error");
      process.stderr.write(
        `[${String(completed).padStart(4)}/${domains.length}] ${row.apex.padEnd(34)} ${verdict}\n`,
      );
    },
  );

  await writeFile(join(outDir, "results.csv"), `${toCsv(rows)}\n`, "utf8");
  await writeFile(
    join(outDir, "results.json"),
    `${JSON.stringify(
      rows.map((r) => r.result ?? r),
      null,
      2,
    )}\n`,
    "utf8",
  );

  const summary = summarise(rows);
  await writeFile(join(outDir, "summary.txt"), `${summary}\n`, "utf8");

  process.stderr.write(summary);
  process.stderr.write(`\n\nwall clock: ${Math.round((Date.now() - started) / 1000)}s`);
  process.stderr.write(`\nwrote ${outDir}/results.csv\n`);
}

await main();
