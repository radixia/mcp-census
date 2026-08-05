/**
 * The geographic floor of Universe R, by apex-domain TLD.
 *
 *   node universe/geo-floor.ts [--csv ...] [--listTld it]
 *
 * "Floor" is the operative word. A ccTLD shows where an organisation chose to
 * register, which is a lower bound on European presence and nothing more: an
 * Italian company on a .com is invisible here, and a .io is as likely to be Berlin
 * as the Bay Area. So the three buckets are reported separately and never blended
 * — the ccTLD signal, the generic TLDs that need enrichment before any
 * geographic claim, and the residue.
 *
 * Only organisations with a **domain-verified namespace** are counted: entries
 * where the registry itself proved control of the domain by DNS or HTTP challenge.
 * The other evidence in Universe R, `endpoint_on_apex`, proves a server answers on
 * the apex but not who controls the namespace, and for a geographic claim about an
 * organisation that distinction is the whole game.
 *
 * The TLD is the last label of the public suffix, so `example.co.uk` counts as
 * `uk`, not `co.uk`.
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { getPublicSuffix } from "tldts";

const { values } = parseArgs({
  options: {
    csv: { type: "string", default: "../data/universe/R-registry-2026-08-05.csv" },
    listTld: { type: "string", default: "it" },
  },
  allowPositionals: true,
});

/**
 * EU member states, the three EEA non-members, and `.eu`.
 *
 * `.ch` and `.uk` are deliberately absent. Switzerland is EFTA and the UK left the
 * EU in 2020. Both are large European markets and get their own line, because a
 * total labelled "EU/EEA" that quietly includes them is how a number gets
 * retracted.
 */
const EU_EEA: Readonly<Record<string, string>> = {
  at: "Austria",
  be: "Belgium",
  bg: "Bulgaria",
  hr: "Croatia",
  cy: "Cyprus",
  cz: "Czechia",
  dk: "Denmark",
  ee: "Estonia",
  fi: "Finland",
  fr: "France",
  de: "Germany",
  gr: "Greece",
  hu: "Hungary",
  ie: "Ireland",
  it: "Italy",
  lv: "Latvia",
  lt: "Lithuania",
  lu: "Luxembourg",
  mt: "Malta",
  nl: "Netherlands",
  pl: "Poland",
  pt: "Portugal",
  ro: "Romania",
  sk: "Slovakia",
  si: "Slovenia",
  es: "Spain",
  se: "Sweden",
  is: "Iceland (EEA)",
  li: "Liechtenstein (EEA)",
  no: "Norway (EEA)",
  eu: "European Union",
};

/** European but outside the EU/EEA. Counted, never folded into the EU total. */
const EUROPE_NON_EU: Readonly<Record<string, string>> = {
  ch: "Switzerland",
  uk: "United Kingdom",
  gb: "United Kingdom (legacy)",
  ua: "Ukraine",
  rs: "Serbia",
  ba: "Bosnia and Herzegovina",
  mk: "North Macedonia",
  al: "Albania",
  md: "Moldova",
  by: "Belarus",
  ru: "Russia",
  tr: "Turkiye",
  ge: "Georgia",
  am: "Armenia",
  az: "Azerbaijan",
};

/**
 * ccTLDs sold as vanity strings, whose country of delegation says nothing about
 * the registrant. Grouped with the ambiguous generics because that is what they
 * behave like.
 *
 * Not a judgement call from a list somewhere — every one was checked against the
 * actual registrants in this dataset. `.me` is the clearest case and mattered
 * most: at 24 it was the largest "European non-EU" entry, ahead of `.uk` (15) and
 * `.ch` (14), and the domains behind it are `ai-know.me`, `foodnear.me`,
 * `drwho.me`, `faxer.me`. Reporting two dozen Montenegrin organisations would
 * have been the single most embarrassing number in the report. Likewise `.sh`
 * (St Helena) is `agentcard.sh`, `copywriting.sh`; `.gg` (Guernsey) is
 * `bluffnet.gg`, `savecraft.gg`; `.to`, `.so` and `.cc` the same.
 *
 * `.io` and `.ai` belong here on the same logic and are already in AMBIGUOUS.
 */
const VANITY_CCTLD: Readonly<Record<string, string>> = {
  me: "Montenegro, used as a vanity string",
  sh: "St Helena, used as a vanity string",
  to: "Tonga, used as a vanity string",
  so: "Somalia, used as a vanity string",
  cc: "Cocos Islands, used as a vanity string",
  gg: "Guernsey, used as a vanity string",
};

/** Generic TLDs carrying no geographic signal. Need seat enrichment. */
const AMBIGUOUS = ["com", "io", "ai", "dev", "app", "org"] as const;

interface Row {
  apex: string;
  kind: string;
  evidence: string;
  server_count: string;
}

function parseCsv(text: string): Row[] {
  const [header, ...lines] = text.trim().split("\n");
  const cols = (header ?? "").split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    cols.forEach((c, i) => {
      row[c] = cells[i] ?? "";
    });
    return row as unknown as Row;
  });
}

/** Last label of the public suffix: `example.co.uk` -> `uk`. */
function tldOf(apex: string): string {
  const suffix = getPublicSuffix(apex, { allowPrivateDomains: false });
  if (suffix === null || suffix === undefined) return "(unknown)";
  const parts = suffix.split(".");
  return (parts[parts.length - 1] ?? suffix).toLowerCase();
}

const pct = (n: number, d: number) => (d === 0 ? "0.0" : ((n / d) * 100).toFixed(1));

async function main(): Promise<void> {
  const rows = parseCsv(await readFile(values.csv as string, "utf8"));
  const orgs = rows.filter((r) => r.kind === "organization");
  const verified = orgs.filter((r) => r.evidence.includes("verified_namespace"));

  const byTld = new Map<string, Row[]>();
  for (const row of verified) {
    const tld = tldOf(row.apex);
    const list = byTld.get(tld) ?? [];
    list.push(row);
    byTld.set(tld, list);
  }
  const count = (tld: string) => byTld.get(tld)?.length ?? 0;

  const out: string[] = [];
  const w = (s = "") => out.push(s);

  w("# Universe R - geographic floor by apex TLD");
  w();
  w(`Source: \`${values.csv}\``);
  w();
  w(`- Apexes in Universe R: **${rows.length}**`);
  w(`- Of those, organisations: **${orgs.length}** (the remainder are platforms)`);
  w(`- Organisations with a **domain-verified namespace**: **${verified.length}**`);
  w(`- Distinct TLDs among them: **${byTld.size}**`);
  w();
  w("Only domain-verified organisations are counted. `endpoint_on_apex` proves a");
  w("server answers on the apex, not who controls the namespace, and for a");
  w("geographic claim that distinction is the whole game.");
  w();

  w("## 1. European ccTLDs");
  w();
  w("### EU / EEA");
  w();
  w("| TLD | Country | Verified orgs | % of verified |");
  w("|---|---|---:|---:|");
  const euEntries = Object.entries(EU_EEA)
    .map(([tld, name]) => ({ tld, name, n: count(tld) }))
    .sort((a, b) => b.n - a.n || a.tld.localeCompare(b.tld));
  for (const e of euEntries) {
    w(`| \`.${e.tld}\` | ${e.name} | ${e.n} | ${pct(e.n, verified.length)}% |`);
  }
  const euTotal = euEntries.reduce((s, e) => s + e.n, 0);
  w(`| **total** | **EU/EEA + .eu** | **${euTotal}** | **${pct(euTotal, verified.length)}%** |`);
  w();

  w("### European, outside the EU/EEA");
  w();
  w("Separate on purpose: Switzerland is EFTA and the UK left in 2020.");
  w();
  w("| TLD | Country | Verified orgs |");
  w("|---|---|---:|");
  const nonEu = Object.entries(EUROPE_NON_EU)
    .map(([tld, name]) => ({ tld, name, n: count(tld) }))
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n);
  for (const e of nonEu) w(`| \`.${e.tld}\` | ${e.name} | ${e.n} |`);
  const nonEuTotal = nonEu.reduce((s, e) => s + e.n, 0);
  w(`| **total** | | **${nonEuTotal}** |`);
  w();

  w("## 2. EU ccTLD total vs grand total");
  w();
  const other = verified.length - euTotal - nonEuTotal;
  w("| | n | % of verified orgs |");
  w("|---|---:|---:|");
  w(`| EU/EEA ccTLDs + \`.eu\` | ${euTotal} | ${pct(euTotal, verified.length)}% |`);
  w(`| European non-EU/EEA | ${nonEuTotal} | ${pct(nonEuTotal, verified.length)}% |`);
  w(`| Everything else | ${other} | ${pct(other, verified.length)}% |`);
  w(`| **Grand total (verified orgs)** | **${verified.length}** | **100%** |`);
  w();

  w("## 3. Ambiguous TLDs - need seat enrichment");
  w();
  w("| TLD | Verified orgs | % of verified |");
  w("|---|---:|---:|");
  let ambiguousTotal = 0;
  for (const tld of AMBIGUOUS) {
    const n = count(tld);
    ambiguousTotal += n;
    w(`| \`.${tld}\` | ${n} | ${pct(n, verified.length)}% |`);
  }
  w("| | | |");
  for (const [tld, why] of Object.entries(VANITY_CCTLD)) {
    const n = count(tld);
    ambiguousTotal += n;
    w(`| \`.${tld}\` | ${n} | ${pct(n, verified.length)}% |`);
    void why;
  }
  w(`| **total** | **${ambiguousTotal}** | **${pct(ambiguousTotal, verified.length)}%** |`);
  w();
  w(
    `**${ambiguousTotal} of ${verified.length} verified organisations (${pct(ambiguousTotal, verified.length)}%) carry no`,
  );
  w("geographic signal.** No European claim can be made about them without");
  w("enrichment. The count includes six ccTLDs sold as vanity strings, listed after");
  w("the blank row above: `.me`, `.sh`, `.to`, `.so`, `.cc`, `.gg`. Every one was");
  w("checked against its actual registrants -- `.me` is `ai-know.me`, `foodnear.me`,");
  w("`drwho.me`, and at 24 it would otherwise have been the largest European");
  w("non-EU entry, ahead of both `.uk` and `.ch`.");
  w("enrichment from another source, and enrichment at that scale is a project,");
  w("not a lookup.");
  w();

  const listTld = (values.listTld as string).replace(/^\./, "").toLowerCase();
  const listed = (byTld.get(listTld) ?? []).sort(
    (a, b) => Number(b.server_count) - Number(a.server_count) || a.apex.localeCompare(b.apex),
  );
  w(`## The full \`.${listTld}\` list (${listed.length})`);
  w();
  if (listed.length === 0) {
    w("_None._");
  } else {
    w("| Apex | Servers | Evidence |");
    w("|---|---:|---|");
    for (const r of listed) {
      w(`| \`${r.apex}\` | ${r.server_count} | ${r.evidence.replace(/\|/g, ", ")} |`);
    }
  }
  w();

  const accounted = new Set([
    ...Object.keys(EU_EEA),
    ...Object.keys(EUROPE_NON_EU),
    ...Object.keys(VANITY_CCTLD),
    ...AMBIGUOUS,
  ]);
  const rest = [...byTld.entries()]
    .filter(([tld]) => !accounted.has(tld))
    .map(([tld, list]) => ({ tld, n: list.length }))
    .sort((a, b) => b.n - a.n);
  const restTotal = rest.reduce((s, r) => s + r.n, 0);
  w(`## Everything else (${rest.length} TLDs, ${restTotal} orgs)`);
  w();
  w("Printed so the buckets above can be checked against the total rather than");
  w("taken on trust.");
  w();
  w(
    rest
      .slice(0, 45)
      .map((r) => `\`.${r.tld}\` ${r.n}`)
      .join(" - "),
  );
  if (rest.length > 45) {
    w();
    w(`_... and ${rest.length - 45} more, all smaller._`);
  }
  w();
  w("### Arithmetic check");
  w();
  w(
    `EU/EEA ${euTotal} + non-EU Europe ${nonEuTotal} + ambiguous ${ambiguousTotal} + rest ${restTotal} = ` +
      `**${euTotal + nonEuTotal + ambiguousTotal + restTotal}** against ${verified.length} verified organisations.`,
  );

  process.stdout.write(`${out.join("\n")}\n`);
  process.stderr.write(
    `\nverified ${verified.length} | EU/EEA ${euTotal} (${pct(euTotal, verified.length)}%) | ` +
      `non-EU Europe ${nonEuTotal} | ambiguous ${ambiguousTotal} (${pct(ambiguousTotal, verified.length)}%) | .${listTld} ${listed.length}\n\n`,
  );
}

await main();
