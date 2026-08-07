/**
 * The two numbers the Server Card working group does not have.
 *
 * Reads a run's JSONL and reports:
 *
 *  1. **`D7` — catalog advertisements from the root document.** The AI Catalog
 *     discovery procedure consults a `Link` header and an HTML `<link>` before
 *     the well-known path, and
 *     https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/43
 *     is open with no data. The decisive figure is how many domains advertise a
 *     catalog somewhere our well-known probe does not reach: if that is large,
 *     the well-known fallback alone is losing deployments; if it is nil, the
 *     fallback is carrying everything and #43 can be closed on evidence.
 *
 *  2. **Cacheability of the documents we did find.** `#33` adopted ETag and
 *     conditional requests as a SHOULD on 2026-07-24. This is the first
 *     measurement of whether anyone follows it.
 *
 *   node --experimental-strip-types analysis/wg-findings.ts --jsonl out/full-0.4.0/results.jsonl
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { jsonl: { type: "string" } } });
if (values.jsonl === undefined) throw new Error("--jsonl is required");

interface Check {
  id: string;
  status: string;
  evidence: Record<string, unknown>;
}

const count = <T extends string>(m: Map<T, number>, k: T) => m.set(k, (m.get(k) ?? 0) + 1);
const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);

const d7Status = new Map<string, number>();
const relations = new Map<string, number>();
const sources = new Map<string, number>();
const cacheEtag = new Map<string, number>();
const cacheControl = new Map<string, number>();
const contentType = new Map<string, number>();
const perCandidateEtag = new Map<string, [number, number]>();

let domains = 0;
let advertising = 0;
let beyondWellKnown = 0;
let advertisedButNoWellKnown = 0;
let documentsFound = 0;

const rl = createInterface({ input: createReadStream(values.jsonl), crlfDelay: Infinity });

for await (const line of rl) {
  if (line.trim() === "") continue;
  domains++;
  const row = JSON.parse(line) as { apex: string; checks: Check[] };
  const checks = new Map(row.checks.map((c) => [c.id, c]));

  const d7 = checks.get("D7");
  if (d7 !== undefined) {
    count(d7Status, d7.status);
    const ads = (d7.evidence.advertisements ?? []) as Array<{ source: string; relation: string }>;
    if (ads.length > 0) advertising++;
    for (const a of ads) {
      count(relations, a.relation);
      count(sources, a.source);
    }
    if (d7.evidence.beyondWellKnown === true) beyondWellKnown++;

    // The decisive case for #43: advertised in a way a conforming client finds,
    // and absent from the path our census probes.
    const d1 = checks.get("D1");
    const wellKnownHit = ((d1?.evidence.respondedWith ?? []) as string[]).includes("ai-catalog");
    if (d7.evidence.beyondWellKnown === true && !wellKnownHit) advertisedButNoWellKnown++;
  }

  const d1 = checks.get("D1");
  for (const probe of (d1?.evidence.candidates ?? []) as Array<{
    candidateId: string;
    result: string;
    cacheability?: Record<string, string>;
  }>) {
    if (probe.result !== "found" || probe.cacheability === undefined) continue;
    documentsFound++;
    const c = probe.cacheability;
    count(cacheEtag, c.etag ?? "unknown");
    count(cacheControl, c.cacheControl ?? "unknown");
    count(contentType, c.contentTypeFamily ?? "unknown");
    const [withEtag, total] = perCandidateEtag.get(probe.candidateId) ?? [0, 0];
    perCandidateEtag.set(probe.candidateId, [withEtag + (c.etag === "present" ? 1 : 0), total + 1]);
  }
}

const pct = (n: number, of: number) => (of === 0 ? "—" : `${((n / of) * 100).toFixed(1)}%`);

console.log(`domains: ${domains}\n`);
console.log("D7 — catalog advertised by the root document");
for (const [k, v] of sorted(d7Status)) console.log(`  ${k.padEnd(22)} ${v}`);
console.log(`  advertising at all      ${advertising}  (${pct(advertising, domains)})`);
console.log(`  beyond the well-known   ${beyondWellKnown}`);
console.log(`  ...and no well-known    ${advertisedButNoWellKnown}   <-- the number for issue #43`);
if (relations.size > 0) {
  console.log("  target relation:");
  for (const [k, v] of sorted(relations)) console.log(`    ${k.padEnd(20)} ${v}`);
  console.log("  advertised via:");
  for (const [k, v] of sorted(sources)) console.log(`    ${k.padEnd(20)} ${v}`);
}

console.log(`\nCacheability of the ${documentsFound} documents found (issue #33)`);
for (const [label, map] of [
  ["ETag", cacheEtag],
  ["Cache-Control", cacheControl],
  ["Content-Type", contentType],
] as const) {
  console.log(`  ${label}:`);
  for (const [k, v] of sorted(map)) {
    console.log(`    ${k.padEnd(22)} ${String(v).padStart(5)}  ${pct(v, documentsFound)}`);
  }
}
console.log("  ETag by candidate path:");
for (const [id, [withEtag, total]] of [...perCandidateEtag].sort((a, b) => b[1][1] - a[1][1])) {
  console.log(`    ${id.padEnd(30)} ${withEtag}/${total}  ${pct(withEtag, total)}`);
}
