/**
 * Build a frozen, citable release snapshot.
 *
 * The acceptance test for this phase is that a stranger can clone the repo and
 * reproduce the headline number. That means the release has to carry everything
 * needed to recompute it — the per-domain rows, the frozen universe, the
 * methodology version, and the candidate set — and it has to be immutable once
 * published.
 *
 *   node export/release.ts --jsonl out/full/results.jsonl --date 2026-09-17
 *
 * Formats: CSV for a spreadsheet, JSON for a program, JSONL for a stream, and a
 * DuckDB script that turns any of them into Parquet without us shipping a
 * Parquet writer. Anyone can point DuckDB at the released files over HTTP and
 * re-derive the statistics without us running a query service.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    jsonl: { type: "string" },
    date: { type: "string" },
    out: { type: "string", default: "../data/releases" },
    universe: { type: "string", default: "../data/universe/R-registry-2026-08-05.csv" },
  },
  allowPositionals: true,
});

// Methodology order, and it is the CSV's column order: an entry out of place
// here silently reorders a published file that people diff between releases.
// `D7` and `C1` join in 0.4.0; both are measured and neither is scored.
const CHECK_IDS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "C1", "Q1", "F1", "F2"] as const;

interface Check {
  id: string;
  status: string;
  evidence: Record<string, unknown>;
}

interface Row {
  apex?: string;
  methodologyVersion?: string;
  candidatesVersion?: string;
  checks?: Check[];
  requestCount?: number;
  score?: { assessed: boolean; score?: number; band?: string; reason?: string };
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function candidatesOf(row: Row): string {
  const d1 = row.checks?.find((c) => c.id === "D1");
  const responded = d1?.evidence.respondedWith;
  return Array.isArray(responded) ? (responded as string[]).join("|") : "";
}

function eraOf(row: Row): string {
  const d5 = row.checks?.find((c) => c.id === "D5");
  const era = d5?.evidence.era;
  return typeof era === "string" ? era : "";
}

async function main(): Promise<void> {
  if (values.jsonl === undefined || values.date === undefined) {
    throw new Error("pass --jsonl <file> --date YYYY-MM-DD");
  }

  const dir = join(values.out as string, values.date);
  await mkdir(dir, { recursive: true });

  const text = await readFile(values.jsonl, "utf8");
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line) as Row;
      if (row.apex !== undefined && !seen.has(row.apex)) {
        seen.add(row.apex);
        rows.push(row);
      }
    } catch {
      // Torn line from an interrupted run.
    }
  }

  rows.sort((a, b) => (a.apex ?? "").localeCompare(b.apex ?? ""));

  // --- CSV -----------------------------------------------------------------
  const header = [
    "apex",
    "assessed",
    "score",
    "band",
    "unassessed_reason",
    ...CHECK_IDS,
    "candidates_responded",
    "protocol_era",
    "requests",
    "methodology_version",
    "candidates_version",
  ];

  const csvLines = rows.map((row) => {
    const status = (id: string) => row.checks?.find((c) => c.id === id)?.status ?? "";
    const score = row.score;
    return [
      row.apex ?? "",
      score?.assessed === true ? "1" : "0",
      score?.assessed === true ? String(score.score ?? "") : "",
      score?.assessed === true ? (score.band ?? "") : "",
      score?.assessed === true ? "" : (score?.reason ?? ""),
      ...CHECK_IDS.map((id) => status(id)),
      candidatesOf(row),
      eraOf(row),
      String(row.requestCount ?? 0),
      row.methodologyVersion ?? "",
      row.candidatesVersion ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });

  await writeFile(
    join(dir, "census.csv"),
    `${[header.join(","), ...csvLines].join("\n")}\n`,
    "utf8",
  );

  // --- JSON and JSONL ------------------------------------------------------
  await writeFile(join(dir, "census.json"), `${JSON.stringify(rows, null, 1)}\n`, "utf8");
  await writeFile(
    join(dir, "census.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf8",
  );

  // --- headline statistics, recomputed here so the release states its own ---
  const assessed = rows.filter((r) => r.score?.assessed === true);
  const passed = (row: Row, id: string) => row.checks?.find((c) => c.id === id)?.status === "pass";
  const anyDiscovery = assessed.filter((r) =>
    ["D1", "D2", "D3", "D4"].some((id) => passed(r, id)),
  ).length;
  const nothing = assessed.length - anyDiscovery;

  const candidateCounts = new Map<string, number>();
  for (const row of assessed) {
    for (const c of candidatesOf(row).split("|").filter(Boolean)) {
      candidateCounts.set(c, (candidateCounts.get(c) ?? 0) + 1);
    }
  }
  const eraCounts = new Map<string, number>();
  for (const row of assessed) {
    const era = eraOf(row);
    if (era !== "") eraCounts.set(era, (eraCounts.get(era) ?? 0) + 1);
  }

  const pct = (n: number) =>
    assessed.length === 0 ? 0 : Math.round((n / assessed.length) * 1000) / 10;

  const summary = {
    release: values.date,
    methodologyVersion: rows[0]?.methodologyVersion ?? "unknown",
    candidatesVersion: rows[0]?.candidatesVersion ?? "unknown",
    domains: rows.length,
    assessed: assessed.length,
    unassessed: rows.length - assessed.length,
    headline: {
      noDiscoverySignal: nothing,
      noDiscoverySignalPct: pct(nothing),
      publishesServerCard: assessed.filter((r) => passed(r, "D1")).length,
      publishesServerCardPct: pct(assessed.filter((r) => passed(r, "D1")).length),
      confirmedHandshake: assessed.filter((r) => passed(r, "D5")).length,
      confirmedHandshakePct: pct(assessed.filter((r) => passed(r, "D5")).length),
    },
    byCheck: Object.fromEntries(
      CHECK_IDS.map((id) => [id, assessed.filter((r) => passed(r, id)).length]),
    ),
    candidateDistribution: Object.fromEntries([...candidateCounts].sort((a, b) => b[1] - a[1])),
    protocolEra: Object.fromEntries([...eraCounts].sort((a, b) => b[1] - a[1])),

    // Added in 0.4.0. Each states its own denominator, because none of them is
    // over the whole population and quoting them as if they were would be the
    // easiest mistake to make with this file.
    rootAdvertisement: rootAdvertisement(rows),
    cardAgainstRuntime: cardAgainstRuntime(rows),
    documentCacheability: documentCacheability(rows),
  };

  await writeFile(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  // --- Parquet, without shipping a Parquet writer ---------------------------
  await writeFile(
    join(dir, "to-parquet.sql"),
    `-- Convert the release to Parquet with DuckDB. No dependency on our side, and
-- you can point DuckDB at the published URLs instead of local files.
--   duckdb < to-parquet.sql
COPY (SELECT * FROM read_csv_auto('census.csv', header=true))
  TO 'census.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- Reproduce the headline number:
--   SELECT round(100.0 * SUM(CASE WHEN D1<>'pass' AND D2<>'pass'
--                                  AND D3<>'pass' AND D4<>'pass'
--                             THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_unreachable
--     FROM read_csv_auto('census.csv', header=true) WHERE assessed = 1;
`,
    "utf8",
  );

  // --- Zenodo deposition metadata ------------------------------------------
  await writeFile(
    join(dir, "zenodo.json"),
    `${JSON.stringify(
      {
        title: `MCP Census ${values.date}: discoverability of Model Context Protocol servers`,
        upload_type: "dataset",
        description:
          `Per-domain measurements of whether an AI agent could discover and connect to an ` +
          `MCP server for each of ${rows.length} organisations that provably run one. ` +
          `Population derived from the official MCP Registry. Methodology ` +
          `${summary.methodologyVersion}, candidate set ${summary.candidatesVersion}. ` +
          `Headline: ${summary.headline.noDiscoverySignalPct}% of assessed organisations ` +
          `publish no discovery signal an agent could use. ` +
          `Conflict of interest: the authors' own domain radixia.ai is included in the ` +
          `measured population rather than excluded, and is disclosed in the methodology.`,
        creators: [{ name: "D'Angelo, Marco", affiliation: "Radixia S.r.l." }],
        license: "cc-by-4.0",
        access_right: "open",
        keywords: [
          "Model Context Protocol",
          "MCP",
          "AI agents",
          "web measurement",
          "service discovery",
          "open data",
        ],
        related_identifiers: [
          {
            identifier: "https://github.com/radixia/mcp-census",
            relation: "isSupplementTo",
            scheme: "url",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  // --- the universe, copied in so the release is self-contained ------------
  try {
    const universe = await readFile(values.universe as string, "utf8");
    await writeFile(join(dir, "universe.csv"), universe, "utf8");
  } catch {
    process.stderr.write("warning: could not copy the universe file\n");
  }

  await writeFile(
    join(dir, "README.md"),
    `# MCP Census — release ${values.date}

**Immutable.** Corrections appear in the next release rather than rewriting this
one; a citable snapshot that changes is not a snapshot. The one exception is an
opt-out received after publication, which is removed from later releases and
from the live site, and noted.

| | |
|---|---|
| Domains | ${rows.length} |
| Assessed | ${assessed.length} |
| Not assessable | ${rows.length - assessed.length} |
| Methodology | \`${summary.methodologyVersion}\` |
| Candidate set | \`${summary.candidatesVersion}\` |

## Headline

**${summary.headline.noDiscoverySignalPct}%** of assessed organisations publish no discovery
signal an agent could use — ${nothing} of ${assessed.length}. ${summary.headline.publishesServerCardPct}%
publish a server card; ${summary.headline.confirmedHandshakePct}% answer a handshake.

Unassessed domains are excluded from every denominator. A domain that excluded our
crawler is reported as its own category, never as a zero.

## Files

| File | What |
|---|---|
| \`census.csv\` | one row per domain, one column per check |
| \`census.json\` | the same rows with full evidence |
| \`census.jsonl\` | the same, one object per line |
| \`summary.json\` | the statistics above, recomputed from these rows |
| \`universe.csv\` | the frozen population, with its provenance |
| \`to-parquet.sql\` | DuckDB script for Parquet, plus the headline query |
| \`zenodo.json\` | deposition metadata |

## Reproducing the headline

\`\`\`sql
SELECT round(100.0 * SUM(CASE WHEN D1<>'pass' AND D2<>'pass'
                               AND D3<>'pass' AND D4<>'pass'
                          THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_unreachable
  FROM read_csv_auto('census.csv', header=true)
 WHERE assessed = 1;
\`\`\`

The population is derived from the official MCP Registry's public API, so nothing
here depends on a licensed input and the universe can be republished in full.

Code Apache-2.0. Data CC-BY-4.0.
`,
    "utf8",
  );

  process.stderr.write(
    `release ${values.date}: ${rows.length} domains, ${assessed.length} assessed, ` +
      `${summary.headline.noDiscoverySignalPct}% with no discovery signal -> ${dir}\n`,
  );
}

await main();

/**
 * `D7`, the discovery route the AI Catalog specification consults before the
 * well-known path. The figure that matters is the last one: advertised where our
 * well-known probe cannot see it, which is what
 * experimental-ext-server-card#43 is open about and has no data for.
 */
function rootAdvertisement(rows: readonly Row[]) {
  const bySource = new Map<string, number>();
  const byRelation = new Map<string, number>();
  let advertising = 0;
  let beyondWellKnown = 0;
  let beyondAndNoWellKnown = 0;

  for (const row of rows) {
    const d7 = row.checks?.find((c) => c.id === "D7");
    if (d7 === undefined) continue;
    const ads = (d7.evidence.advertisements ?? []) as Array<{
      source: string;
      relation: string;
    }>;
    if (ads.length > 0) advertising++;
    for (const a of ads) {
      bySource.set(a.source, (bySource.get(a.source) ?? 0) + 1);
      byRelation.set(a.relation, (byRelation.get(a.relation) ?? 0) + 1);
    }
    if (d7.evidence.beyondWellKnown !== true) continue;
    beyondWellKnown++;
    const d1 = row.checks?.find((c) => c.id === "D1");
    const responded = (d1?.evidence.respondedWith ?? []) as string[];
    if (!responded.includes("ai-catalog")) beyondAndNoWellKnown++;
  }

  return {
    denominator: rows.length,
    advertising,
    beyondWellKnown,
    beyondWellKnownAndNoWellKnownDocument: beyondAndNoWellKnown,
    bySource: Object.fromEntries(bySource),
    byTargetRelation: Object.fromEntries(byRelation),
  };
}

/**
 * `C1`. The denominator is domains where a card and a handshake both exist, not
 * the population — 478 of 7,422 in the first run that measured it.
 *
 * `nameDiverges` is reported apart from the contradictions on purpose: a card
 * carrying a display name against a runtime reporting a software package is not
 * a publisher in breach, it is two fields with no shared declared meaning.
 */
function cardAgainstRuntime(rows: readonly Row[]) {
  const contradicted = new Map<string, number>();
  let comparable = 0;
  let contradicts = 0;
  let nameDiverges = 0;
  let cardAhead = 0;
  let cardBehind = 0;

  const numeric = (v: unknown) =>
    typeof v === "string" && /^\d+(\.\d+)*$/.test(v) ? v : undefined;

  for (const row of rows) {
    const c1 = row.checks?.find((c) => c.id === "C1");
    if (c1 === undefined || (c1.status !== "pass" && c1.status !== "fail")) continue;
    comparable++;
    if (c1.evidence.nameDiverges === true) nameDiverges++;
    const fields = (c1.evidence.contradictedFields ?? []) as string[];
    if (fields.length > 0) contradicts++;
    for (const f of fields) contradicted.set(f, (contradicted.get(f) ?? 0) + 1);

    if (!fields.includes("version")) continue;
    const card = numeric(
      (
        (row.checks?.find((c) => c.id === "D1")?.evidence.cardIdentity ?? {}) as {
          version?: unknown;
        }
      ).version,
    );
    const runtime = numeric(
      (
        (row.checks?.find((c) => c.id === "D5")?.evidence.serverInfo ?? {}) as {
          version?: unknown;
        }
      ).version,
    );
    if (card === undefined || runtime === undefined) continue;
    const cmp = card.localeCompare(runtime, undefined, { numeric: true });
    if (cmp > 0) cardAhead++;
    else if (cmp < 0) cardBehind++;
  }

  return {
    denominator: comparable,
    contradicts,
    contradictedFields: Object.fromEntries(contradicted),
    nameDiverges,
    // Not drift. If cards merely went stale they would nearly all be behind.
    versionConflictDirection: { cardAhead, cardBehind },
  };
}

/** Cacheability of the documents found, against the SHOULD adopted in #33. */
function documentCacheability(rows: readonly Row[]) {
  const etag = new Map<string, number>();
  const cacheControl = new Map<string, number>();
  const contentType = new Map<string, number>();
  let documents = 0;

  for (const row of rows) {
    const d1 = row.checks?.find((c) => c.id === "D1");
    for (const probe of (d1?.evidence.candidates ?? []) as Array<{
      result: string;
      cacheability?: Record<string, string>;
    }>) {
      if (probe.result !== "found" || probe.cacheability === undefined) continue;
      documents++;
      const c = probe.cacheability;
      // A field this run did not record counts as `unrecorded` rather than
      // vanishing: a category that silently drops rows makes the denominators
      // below disagree with each other.
      const bump = (m: Map<string, number>, v: string | undefined) => {
        const key = v ?? "unrecorded";
        m.set(key, (m.get(key) ?? 0) + 1);
      };
      bump(etag, c.etag);
      bump(cacheControl, c.cacheControl);
      bump(contentType, c.contentTypeFamily);
    }
  }

  return {
    denominator: documents,
    etag: Object.fromEntries(etag),
    cacheControl: Object.fromEntries(cacheControl),
    contentTypeFamily: Object.fromEntries(contentType),
  };
}
