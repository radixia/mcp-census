/**
 * Assemble a release JSONL from a Worker-driven run.
 *
 * Runs driven by the Worker split a domain's result across two stores, and
 * neither half is a release on its own:
 *
 *   R2  evidence/<apex>/<run>.json   apex, both versions, checks
 *   D1  scans                        timings, request count, score, band
 *
 * `store.ts` writes exactly five fields to R2 and puts the score in D1, so
 * concatenating the R2 objects — which is all the evidence bundler does —
 * produces rows with no `score`, `requestCount`, `durationMs` or `observedAt`.
 * Fed to `release.ts` those become empty `assessed`, `score` and `band` columns
 * for every domain in the published CSV. The August releases did not hit this
 * because they came from the local pilot runner, whose rows carry everything.
 *
 * `score.components` is in neither store. It is recomputed here with the same
 * `scoreDomain()` the crawl used — scoring is deterministic from the checks,
 * which is a property the project publishes — and the recomputed score and band
 * are then checked against the ones D1 recorded at crawl time. A disagreement
 * means the published score cannot be reproduced from the published evidence,
 * which is the one thing this dataset must never be, so it fails loudly rather
 * than writing a row.
 *
 *   node export/from-worker-run.ts --run 41 --evidence <dir> --scans <map.json> --out <file.jsonl>
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { scoreDomain } from "@mcp-census/core";

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    evidence: { type: "string" },
    scans: { type: "string" },
    out: { type: "string" },
  },
});

interface ScanRow {
  apex: string;
  started_at: string;
  finished_at: string | null;
  request_count: number;
  duration_ms: number | null;
  assessed: number;
  score: number | null;
  band: string | null;
  unassessed_reason: string | null;
}

async function main(): Promise<void> {
  const { run, evidence, scans, out } = values;
  if (!run || !evidence || !scans || !out) {
    throw new Error("pass --run <id> --evidence <dir> --scans <map.json> --out <file.jsonl>");
  }

  const scanMap = JSON.parse(await readFile(scans, "utf8")) as Record<string, ScanRow>;
  const files = (await readdir(evidence)).filter((f) => f.endsWith(".json"));

  const lines: string[] = [];
  const missingEvidence: string[] = [];
  const mismatches: string[] = [];

  for (const apex of Object.keys(scanMap).sort((a, b) => a.localeCompare(b))) {
    const scan = scanMap[apex];
    if (scan === undefined) continue;
    let raw: string;
    try {
      raw = await readFile(join(evidence, `${apex}.json`), "utf8");
    } catch {
      missingEvidence.push(apex);
      continue;
    }
    const ev = JSON.parse(raw) as {
      checks?: unknown[];
      methodologyVersion?: string;
      candidatesVersion?: string;
    };
    const checks = (ev.checks ?? []) as Parameters<typeof scoreDomain>[0];

    // Recompute, then hold it against what the crawl recorded.
    const score = scoreDomain(checks);
    const d1Assessed = scan.assessed === 1;
    if (score.assessed !== d1Assessed) {
      mismatches.push(`${apex}: assessed ${score.assessed} vs D1 ${d1Assessed}`);
    } else if (score.assessed) {
      if (score.score !== scan.score)
        mismatches.push(`${apex}: score ${score.score} vs D1 ${scan.score}`);
      if (score.band !== scan.band)
        mismatches.push(`${apex}: band ${score.band} vs D1 ${scan.band}`);
    } else if (score.reason !== scan.unassessed_reason) {
      mismatches.push(`${apex}: reason ${score.reason} vs D1 ${scan.unassessed_reason}`);
    }

    lines.push(
      JSON.stringify({
        apex,
        methodologyVersion: ev.methodologyVersion,
        candidatesVersion: ev.candidatesVersion,
        score,
        requestCount: scan.request_count,
        durationMs: scan.duration_ms,
        observedAt: scan.started_at,
        checks,
      }),
    );
  }

  console.log(`run ${run}: ${lines.length} rows from ${files.length} evidence objects`);
  if (missingEvidence.length > 0) {
    console.error(
      `MISSING EVIDENCE for ${missingEvidence.length}: ${missingEvidence.slice(0, 10).join(", ")}`,
    );
  }
  if (mismatches.length > 0) {
    console.error(`SCORE MISMATCHES ${mismatches.length}:`);
    for (const m of mismatches.slice(0, 20)) console.error(`  ${m}`);
    throw new Error("recomputed scores disagree with D1; refusing to write");
  }
  if (missingEvidence.length > 0) throw new Error("incomplete evidence; refusing to write");

  await writeFile(out, `${lines.join("\n")}\n`, "utf8");
  console.log(`wrote ${out}`);
}

await main();
