/**
 * Expand a run's evidence bundle into the per-domain objects the schema promises.
 *
 * `scans.evidence_key` says `evidence/<apex>/<run_id>.json` on every row of every
 * run. For the two runs driven by the local runner and loaded with
 * `pilot/import.ts`, no such object was ever written: the importer set the
 * column and wrote nothing to R2. Both full censuses spent time with 7,422
 * dangling pointers each, on a project whose stated value is that a score can be
 * re-examined without re-crawling.
 *
 * The per-apex key is not a convenience. It is how the opt-out promise is kept:
 * "delete everything about this domain" has to be a prefix delete rather than a
 * scan across every run we have ever done, which is why ADR 0005 chose the
 * layout. A single bundle satisfies re-examination poorly and the opt-out not at
 * all, so the bundle is the safety copy and these are the artifact.
 *
 *   node --experimental-strip-types evidence/expand.ts --jsonl <file> --run 6
 *
 * Writes to `out/evidence-<run>/<apex>` and prints nothing but a count. The
 * upload is a separate step on purpose: this half is cheap and repeatable, the
 * other half talks to a paid API a few thousand times.
 */

import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    jsonl: { type: "string" },
    run: { type: "string" },
    out: { type: "string", default: "out" },
  },
});

if (values.jsonl === undefined || values.run === undefined) {
  throw new Error("--jsonl and --run are both required");
}

const runId = Number.parseInt(values.run, 10);
if (!Number.isInteger(runId) || runId <= 0) throw new Error(`--run must be a run id`);

const dir = join(values.out, `evidence-${runId}`);
const rl = createInterface({
  input: createReadStream(values.jsonl),
  crlfDelay: Infinity,
});

let written = 0;
for await (const line of rl) {
  if (line.trim() === "") continue;
  const row = JSON.parse(line) as {
    apex: string;
    methodologyVersion?: string;
    candidatesVersion?: string;
    checks?: unknown;
  };

  // Exactly the shape `apps/worker/src/store.ts` writes on the queue path, so a
  // reader cannot tell which route produced a given run's evidence.
  const object = {
    apex: row.apex,
    runId,
    methodologyVersion: row.methodologyVersion,
    candidatesVersion: row.candidatesVersion,
    checks: row.checks ?? [],
  };

  const path = join(dir, row.apex);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(object), "utf8");
  written++;
}

process.stderr.write(`${written} objects -> ${dir}\n`);
