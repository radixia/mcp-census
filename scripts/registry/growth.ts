/**
 * Turn a registry snapshot into the monthly growth series.
 *
 *   node registry/growth.ts --registry out/registry.json --snapshot 2026-08-05
 *
 * Emits SQL on stdout's file so the insert goes through `wrangler d1 execute`,
 * matching pilot/import.ts — one authenticated path to the database.
 *
 * This is the one number on the site that we do not measure ourselves: it is the
 * registry's own count of servers it holds, keyed on each entry's `publishedAt`.
 * It answers "how fast is the ecosystem growing", which is a different question
 * from "how much of it can an agent reach", and the two must never be blended
 * into one line on one chart.
 *
 * The final month is almost always incomplete and is flagged `partial`. A
 * snapshot taken on the 5th shows five days of a month next to thirty of the one
 * before, which renders as a cliff. Marking it is the difference between a chart
 * that is honest and one that accidentally announces a crash.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    registry: { type: "string", default: "out/registry.json" },
    snapshot: { type: "string" },
    out: { type: "string", default: "out/registry-growth.sql" },
  },
  allowPositionals: true,
});

interface Entry {
  readonly _meta?: Record<string, { readonly publishedAt?: string } | undefined>;
  readonly server?: { readonly publishedAt?: string };
}

/** The registry nests its own timestamps under a namespaced `_meta` key. */
function publishedAt(entry: Entry): string | undefined {
  const official = entry._meta?.["io.modelcontextprotocol.registry/official"];
  return official?.publishedAt ?? entry.server?.publishedAt;
}

async function main(): Promise<void> {
  const snapshot = values.snapshot;
  if (snapshot === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot)) {
    throw new Error("pass --snapshot YYYY-MM-DD (the date the registry was pulled)");
  }

  const raw = JSON.parse(await readFile(values.registry as string, "utf8")) as
    | Entry[]
    | { servers?: Entry[]; results?: Entry[] };
  const entries = Array.isArray(raw) ? raw : (raw.servers ?? raw.results ?? []);

  const added = new Map<string, number>();
  let undated = 0;
  for (const entry of entries) {
    const published = publishedAt(entry);
    if (published === undefined) {
      undated++;
      continue;
    }
    const month = published.slice(0, 7);
    added.set(month, (added.get(month) ?? 0) + 1);
  }

  const months = [...added.keys()].sort();
  const snapshotMonth = snapshot.slice(0, 7);

  const rows: string[] = ["DELETE FROM registry_growth;"];
  let cumulative = 0;
  for (const month of months) {
    const n = added.get(month) ?? 0;
    cumulative += n;
    // Partial if the snapshot was taken inside this month, or somehow before it.
    const partial = month >= snapshotMonth ? 1 : 0;
    rows.push(
      `INSERT INTO registry_growth (month, added, cumulative, partial, snapshot_date) ` +
        `VALUES ('${month}', ${n}, ${cumulative}, ${partial}, '${snapshot}');`,
    );
  }

  await writeFile(values.out as string, `${rows.join("\n")}\n`, "utf8");

  process.stderr.write(
    [
      "",
      `${entries.length} registry entries, ${undated} with no publishedAt`,
      `${months.length} months: ${months[0]} -> ${months[months.length - 1]}`,
      `cumulative at snapshot: ${cumulative}`,
      `partial month flagged: ${snapshotMonth}`,
      "",
      `wrote ${values.out} (${rows.length} statements)`,
      "",
    ].join("\n"),
  );
}

await main();
