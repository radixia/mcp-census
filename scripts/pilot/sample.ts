/**
 * Builds the Phase 1 pilot sample from a Tranco list.
 *
 * The Tranco CSV itself is **not committed** — it aggregates sources under
 * differing licences, including Cloudflare Radar under CC BY-NC 4.0, and that
 * question is unresolved (see METHODOLOGY → Open questions). What is committed
 * is this selection rule plus the list ID, which is what makes the sample
 * reproducible without redistributing anything.
 *
 *   node pilot/sample.ts --tranco <top-1m.csv> --id <list-id> --out <file>
 *
 * The sample is deliberately mixed rather than purely top-ranked: a global head
 * sample tells us the ceiling, and the European and Italian slices are the
 * populations nobody else measures.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    tranco: { type: "string" },
    id: { type: "string", default: "unknown" },
    out: { type: "string", default: "out/pilot-sample.txt" },
  },
  allowPositionals: true,
});

/** Quotas per stratum. */
const GLOBAL = 250;
const EUROPEAN = 150;
const ITALIAN = 100;

const EUROPEAN_TLDS = new Set([
  "de", "fr", "es", "nl", "se", "pl", "be", "at", "dk", "fi", "no", "ie", "pt",
  "gr", "cz", "ch", "uk", "eu", "hu", "ro", "sk", "si", "hr", "bg", "lt", "lv",
  "ee", "lu", "is", "mt", "cy", "rs", "ua",
]);

/**
 * Infrastructure that is not a brand with a website. Including these would
 * depress the hit rate with domains no agent would ever try to talk to, which
 * is exactly the criticism levelled at convenience samples.
 */
const INFRASTRUCTURE = [
  "gtld-servers.net", "root-servers.net", "nstld.com", "in-addr.arpa", "ip6.arpa",
  "akamai.net", "akamaiedge.net", "akadns.net", "akamaitechnologies.com",
  "cloudfront.net", "amazonaws.com", "azureedge.net", "azure.com", "trafficmanager.net",
  "googleapis.com", "gstatic.com", "ggpht.com", "googleusercontent.com", "googlevideo.com",
  "doubleclick.net", "googlesyndication.com", "googletagmanager.com", "google-analytics.com",
  "windowsupdate.com", "ntp.org", "cloudflare-dns.com", "fbcdn.net", "cdninstagram.com",
  "licdn.com", "twimg.com", "ytimg.com", "aaplimg.com", "apple-dns.net",
  "edgekey.net", "edgesuite.net", "llnwd.net", "cdn77.org", "fastly.net", "fastlylb.net",
];

function isInfrastructure(domain: string): boolean {
  return INFRASTRUCTURE.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
}

function tld(domain: string): string {
  const parts = domain.split(".");
  return parts[parts.length - 1] ?? "";
}

async function main(): Promise<void> {
  if (values.tranco === undefined) throw new Error("pass --tranco <top-1m.csv>");

  const text = await readFile(values.tranco, "utf8");
  const ranked: Array<{ rank: number; domain: string }> = [];

  for (const line of text.split("\n")) {
    const comma = line.indexOf(",");
    if (comma <= 0) continue;
    const rank = Number.parseInt(line.slice(0, comma), 10);
    const domain = line.slice(comma + 1).trim().toLowerCase();
    if (!Number.isFinite(rank) || domain === "" || isInfrastructure(domain)) continue;
    ranked.push({ rank, domain });
  }

  const chosen = new Set<string>();
  const take = (n: number, predicate: (d: string) => boolean) => {
    let taken = 0;
    for (const { domain } of ranked) {
      if (taken >= n) break;
      if (chosen.has(domain) || !predicate(domain)) continue;
      chosen.add(domain);
      taken++;
    }
    return taken;
  };

  const global = take(GLOBAL, () => true);
  const european = take(EUROPEAN, (d) => EUROPEAN_TLDS.has(tld(d)));
  const italian = take(ITALIAN, (d) => tld(d) === "it");

  // We are in our own dataset. Never excluded, disclosed in METHODOLOGY.
  chosen.add("radixia.ai");

  const header = [
    "# MCP Census — Phase 1 pilot sample",
    `# source: Tranco, list id ${values.id}`,
    `# selection: top ${GLOBAL} global + top ${EUROPEAN} European ccTLD + top ${ITALIAN} .it,`,
    "#            infrastructure domains excluded, plus radixia.ai",
    `# strata actually filled: global=${global} european=${european} italian=${italian}`,
    `# total: ${chosen.size}`,
    "",
  ].join("\n");

  await writeFile(values.out as string, `${header}${[...chosen].join("\n")}\n`, "utf8");
  process.stderr.write(
    `${chosen.size} domains -> ${values.out} (global ${global}, european ${european}, italian ${italian})\n`,
  );
}

await main();
