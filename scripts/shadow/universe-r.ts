/**
 * Build Universe R: the organizations that provably run an MCP server.
 *
 * Derived entirely from the official MCP Registry's own public API, so unlike a
 * ranked-domain list there is no third-party licensing question and the whole
 * universe can be republished alongside results.
 *
 * Two sources of proof, both things only the domain owner can produce:
 *
 *  - a **domain-verified namespace**. Registry names are reverse-DNS and the
 *    registry verifies ownership by DNS or HTTP challenge before allowing a
 *    publish, so `com.stripe/*` is provably `stripe.com`.
 *  - a **remote endpoint hosted on the apex**. Only the owner can serve from
 *    `mcp.stripe.com`.
 *
 * `io.github.*` namespaces are excluded as a source of apexes: they verify a
 * GitHub account, reverse to `<user>.github.io`, and are never the brand. Their
 * *endpoints* still count, which is how first-party servers published under a
 * company's GitHub org (Zoom) are correctly included.
 *
 * This is the population that makes the census question answerable. Probing the
 * web's top domains yields ~1% and duplicates Cloudflare; probing domains known
 * to run a server turns "are they reachable?" into a real statistic.
 *
 *   node shadow/universe-r.ts --registry out/registry.json --out ../data/universe/R-registry.csv
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { getDomain, getPublicSuffix } from "tldts";

import type { RegistryEntry } from "./pull.ts";

const { values } = parseArgs({
  options: {
    registry: { type: "string", default: "out/registry.json" },
    out: { type: "string", default: "../data/universe/R-registry.csv" },
    pulled: { type: "string", default: "unknown" },
  },
  allowPositionals: true,
});

/** Reserved or shared-infrastructure names that are nobody's brand. */
const NOT_A_BRAND = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
  "localhost",
  "test",
  "invalid",
  "local",
]);

function isBrandApex(apex: string): boolean {
  if (NOT_A_BRAND.has(apex)) return false;
  if (!apex.includes(".")) return false;
  // A registrable domain equal to its own public suffix is a shared suffix
  // (`workers.dev`, `github.io`): everyone's subdomain, nobody's brand.
  return getPublicSuffix(apex, { allowPrivateDomains: true }) !== apex;
}

function apexOf(host: string): string | undefined {
  const apex = getDomain(host, { allowPrivateDomains: true });
  return apex !== null && isBrandApex(apex) ? apex : undefined;
}

interface Row {
  readonly apex: string;
  evidence: Set<string>;
  servers: Set<string>;
  /**
   * Servers hosted on this apex whose namespace belongs to somebody else.
   *
   * This is what separates a **platform** from a **brand**. `smithery.ai`,
   * `alpic.live` and `pipeworx.io` host other people's servers; `stripe.com`
   * hosts its own. Both are legitimately "an organization running an MCP
   * server", but mixing them silently would let a few thousand hobby
   * deployments on shared infrastructure drive the headline rate.
   */
  foreignHosted: Set<string>;
}

async function main(): Promise<void> {
  const registry = JSON.parse(await readFile(values.registry as string, "utf8")) as RegistryEntry[];
  const rows = new Map<string, Row>();

  const add = (apex: string, evidence: string, server: string, foreign = false) => {
    const row = rows.get(apex) ?? {
      apex,
      evidence: new Set<string>(),
      servers: new Set<string>(),
      foreignHosted: new Set<string>(),
    };
    row.evidence.add(evidence);
    row.servers.add(server);
    if (foreign) row.foreignHosted.add(server);
    rows.set(apex, row);
  };

  for (const entry of registry) {
    if (entry._meta?.["io.modelcontextprotocol.registry/official"]?.status === "deleted") continue;

    const name = entry.server?.name ?? "";
    const namespace = name.split("/")[0] ?? "";
    if (namespace === "") continue;

    const namespaceApex = namespace.toLowerCase().startsWith("io.github.")
      ? undefined
      : apexOf(namespace.split(".").reverse().join(".").toLowerCase());

    if (namespaceApex !== undefined) add(namespaceApex, "verified_namespace", name);

    for (const remote of entry.server.remotes ?? []) {
      if (remote.url === undefined) continue;
      let host: string;
      try {
        host = new URL(remote.url).hostname.toLowerCase();
      } catch {
        continue;
      }
      // Template placeholders like `{env}.azurewebsites.net` are not real hosts.
      if (host.includes("{") || host.includes("*")) continue;
      const apex = apexOf(host);
      if (apex !== undefined) add(apex, "endpoint_on_apex", name, apex !== namespaceApex);
    }
  }

  const sorted = [...rows.values()].sort((a, b) => {
    const diff = b.servers.size - a.servers.size;
    return diff !== 0 ? diff : a.apex.localeCompare(b.apex);
  });

  // A domain hosting several servers that belong to other namespaces is acting
  // as a hosting platform, not as a brand publishing its own server.
  const PLATFORM_THRESHOLD = 3;
  const kind = (r: Row) =>
    r.foreignHosted.size >= PLATFORM_THRESHOLD ? "platform" : "organization";

  const csv = [
    "apex,kind,evidence,server_count,foreign_hosted",
    ...sorted.map(
      (r) =>
        `${r.apex},${kind(r)},${[...r.evidence].sort().join("|")},${r.servers.size},${r.foreignHosted.size}`,
    ),
  ].join("\n");

  await writeFile(values.out as string, `${csv}\n`, "utf8");

  const orgs = sorted.filter((r) => kind(r) === "organization");
  const platforms = sorted.filter((r) => kind(r) === "platform");
  const both = orgs.filter((r) => r.evidence.size === 2).length;
  const nsOnly = orgs.filter((r) => r.evidence.has("verified_namespace") && r.evidence.size === 1);
  const epOnly = orgs.filter((r) => r.evidence.has("endpoint_on_apex") && r.evidence.size === 1);

  process.stderr.write(
    [
      "",
      `Universe R: ${sorted.length} apexes with an MCP server`,
      `  organizations (own servers): ${orgs.length}`,
      `  platforms (host others'):    ${platforms.length}`,
      "",
      "Organizations, by evidence:",
      `  verified namespace only: ${nsOnly.length}`,
      `  endpoint on apex only:   ${epOnly.length}`,
      `  both:                    ${both}`,
      "",
      "Largest platforms (excluded from the organization count):",
      ...platforms
        .slice(0, 8)
        .map((r) => `  ${r.apex.padEnd(26)} ${String(r.servers.size).padStart(4)} servers`),
      "",
      `wrote ${values.out}`,
      "",
    ].join("\n"),
  );
}

await main();
