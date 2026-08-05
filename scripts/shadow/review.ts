/**
 * Turn shadow candidates into a reviewable worklist, deduplicated by brand.
 *
 * The classification is not publishable on its own — see
 * docs/SHADOW-2026-08-05.md. Name matching works on distinctive brands and
 * collapses on ordinary words, sampled precision is about 85%, and a false
 * claim here is a public accusation about who wrote somebody's software.
 *
 * So this does the two things that were actually missing, and stops short of
 * pretending the rest is automatic:
 *
 *  1. **Brand-level dedup.** `amazon.com`, `.co.uk`, `.de`, `.fr`, `.es`, `.it`
 *     were six rows carrying the same eighteen matches. They are one brand.
 *  2. **A review file.** Every candidate lands in a CSV with a blank verdict
 *     column. Only rows marked `confirmed` are ever published, and the count of
 *     unreviewed rows is reported so "how much is unchecked" is never a mystery.
 *
 *   node shadow/review.ts --shadow out/shadow.json --out out/shadow-review.csv
 *
 * Re-running merges any verdicts already recorded, so review survives a rebuild.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { getPublicSuffix } from "tldts";

const { values } = parseArgs({
  options: {
    shadow: { type: "string", default: "out/shadow.json" },
    out: { type: "string", default: "out/shadow-review.csv" },
  },
  allowPositionals: true,
});

interface Match {
  serverName: string;
  namespace: string;
  claim: string;
  confidence: number;
  firstParty: boolean;
}

interface Result {
  apex: string;
  classification: string;
  hasOwnCard: boolean;
  matches: Match[];
}

/** `amazon.co.uk` -> `amazon`. The label immediately left of the public suffix. */
export function brandKey(apex: string): string {
  const suffix = getPublicSuffix(apex, { allowPrivateDomains: true }) ?? "";
  const stem = suffix === "" ? apex : apex.slice(0, -(suffix.length + 1));
  const parts = stem.split(".");
  return (parts[parts.length - 1] ?? apex).toLowerCase();
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function loadExistingVerdicts(path: string): Promise<Map<string, string>> {
  const verdicts = new Map<string, string>();
  try {
    const text = await readFile(path, "utf8");
    const [, ...lines] = text.trim().split("\n");
    for (const line of lines) {
      const cells = line.split(",");
      const brand = cells[0];
      const server = cells[2];
      const verdict = cells[5];
      if (brand !== undefined && server !== undefined && verdict !== undefined && verdict !== "") {
        verdicts.set(`${brand}|${server}`, verdict);
      }
    }
  } catch {
    // No prior review file. Everything starts unreviewed.
  }
  return verdicts;
}

async function main(): Promise<void> {
  const report = JSON.parse(await readFile(values.shadow as string, "utf8")) as {
    results: Result[];
  };
  const existing = await loadExistingVerdicts(values.out as string);

  // Group by brand, keeping every apex that led us there so the reviewer can see
  // whether a match is about the brand or about a coincidence of naming.
  interface Brand {
    key: string;
    apexes: Set<string>;
    matches: Map<string, Match>;
    hasOwnCard: boolean;
  }
  const brands = new Map<string, Brand>();

  for (const result of report.results) {
    if (result.classification !== "shadow_candidate") continue;

    const key = brandKey(result.apex);
    const brand =
      brands.get(key) ??
      ({ key, apexes: new Set(), matches: new Map(), hasOwnCard: false } satisfies Brand);

    brand.apexes.add(result.apex);
    brand.hasOwnCard = brand.hasOwnCard || result.hasOwnCard;
    for (const match of result.matches) {
      // Only the shadow-qualifying signal is worth a reviewer's time.
      if (match.firstParty || match.confidence < 0.6) continue;
      brand.matches.set(match.serverName, match);
    }
    brands.set(key, brand);
  }

  const rows: string[] = [];
  let unreviewed = 0;
  let confirmed = 0;
  let rejected = 0;

  const sorted = [...brands.values()].sort((a, b) => b.matches.size - a.matches.size);

  for (const brand of sorted) {
    for (const match of [...brand.matches.values()].sort((a, b) =>
      a.serverName.localeCompare(b.serverName),
    )) {
      const verdict = existing.get(`${brand.key}|${match.serverName}`) ?? "";
      if (verdict === "confirmed") confirmed++;
      else if (verdict === "rejected") rejected++;
      else unreviewed++;

      rows.push(
        [
          brand.key,
          [...brand.apexes].sort().join("|"),
          match.serverName,
          match.namespace,
          match.claim,
          verdict,
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }

  const header = "brand,apexes,server_name,namespace,claim,verdict";
  await writeFile(values.out as string, `${[header, ...rows].join("\n")}\n`, "utf8");

  const candidateApexes = report.results.filter(
    (r) => r.classification === "shadow_candidate",
  ).length;

  process.stderr.write(
    [
      "",
      `Shadow candidates: ${candidateApexes} apexes -> ${brands.size} brands`,
      `  (ccTLD dedup removed ${candidateApexes - brands.size} duplicate rows)`,
      "",
      `Matches to review: ${rows.length}`,
      `  confirmed: ${confirmed}`,
      `  rejected:  ${rejected}`,
      `  unreviewed: ${unreviewed}`,
      "",
      "Only rows marked `confirmed` may be published. Fill the verdict column and",
      "re-run to merge; nothing is lost on a rebuild.",
      "",
      `wrote ${values.out}`,
      "",
    ].join("\n"),
  );
}

await main();
