/**
 * Shadow MCP: join the registry against the census and classify each domain.
 *
 * Attribution is driven by evidence only the domain owner could produce, rather
 * than by string similarity — see docs/DECISIONS/0003. Two things qualify:
 *
 *  - a **registry-verified namespace** reversing to the apex. Server names are
 *    reverse-DNS and the registry verifies namespace ownership by DNS or HTTP
 *    challenge, so `com.stripe/*` is provably controlled by `stripe.com`.
 *  - a **remote endpoint hosted on the apex**. Only the domain owner can serve
 *    from `mcp.stripe.com`. This is the same class of proof as the above, and
 *    treating it as third-party evidence (as a first pass did) misclassifies
 *    first-party servers published under a company's GitHub org.
 *
 * Everything else — the brand's name appearing in a title, a `websiteUrl`
 * pointing at them — is a *claim*, not proof, and is kept out of the headline.
 *
 * A public suffix list is mandatory here. Without one, `cronping.workers.dev`
 * reads as first-party evidence for `workers.dev`, and Cloudflare appears to
 * operate 555 MCP servers it has never heard of.
 *
 *   node shadow/classify.ts --registry out/registry.json --census out/pilot/results.csv
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { getDomain, getPublicSuffix } from "tldts";

import type { RegistryEntry } from "./pull.ts";

const { values } = parseArgs({
  options: {
    registry: { type: "string", default: "out/registry.json" },
    census: { type: "string", default: "out/pilot/results.csv" },
    out: { type: "string", default: "out/shadow.json" },
  },
  allowPositionals: true,
});

/** `com.example` -> `example.com`. The registry's namespaces are reverse-DNS. */
export function namespaceToDomain(namespace: string): string {
  return namespace.split(".").reverse().join(".").toLowerCase();
}

/**
 * `io.github.<user>` verifies a GitHub *account*, not a brand's domain, and
 * reverses to `<user>.github.io` — never the brand. It cannot be read as
 * first-party evidence on its own.
 */
export function isGitHubNamespace(namespace: string): boolean {
  return namespace.toLowerCase().startsWith("io.github.");
}

/**
 * Domains that are shared infrastructure or reserved for documentation, and so
 * can never be a "brand" in the sense this classification means. Anything whose
 * registrable domain equals its own public suffix is caught automatically; this
 * list covers RFC 2606 and a few hosts that are not on the PSL.
 */
const NOT_A_BRAND = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
  "localhost",
  "test",
  "invalid",
]);

export function isBrandDomain(apex: string): boolean {
  if (NOT_A_BRAND.has(apex)) return false;
  // `workers.dev`, `github.io`, `pages.dev` are public suffixes: everyone's
  // subdomain, nobody's brand.
  const suffix = getPublicSuffix(apex, { allowPrivateDomains: true });
  return suffix !== apex;
}

/**
 * Is `host` controlled by whoever owns `apex`?
 *
 * PSL-aware: `foo.workers.dev` has registrable domain `foo.workers.dev`, not
 * `workers.dev`, so it is *not* Cloudflare's.
 */
export function isControlledBy(host: string, apex: string): boolean {
  if (host === apex) return true;
  if (!host.endsWith(`.${apex}`)) return false;
  return getDomain(host, { allowPrivateDomains: true }) === apex;
}

function hostOf(url: string | undefined): string | undefined {
  if (url === undefined || url === "") return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** `shopify.com` -> `shopify`. Weak secondary signal only. */
function brandToken(apex: string): string {
  const suffix = getPublicSuffix(apex, { allowPrivateDomains: true }) ?? "";
  const stem = suffix === "" ? apex : apex.slice(0, -(suffix.length + 1));
  const parts = stem.split(".");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/**
 * Tokens too generic to match on. A false shadow claim is a public accusation
 * about who wrote somebody's software, so this errs heavily toward dropping
 * matches.
 *
 * Every entry here was added because it produced an observed false positive:
 * `unifi.it` (the University of Florence) collided with Ubiquiti's UniFi,
 * `oracle.com` with `token-oracle`, `index.hr` with `h-index`, `admin.ch` with
 * `shopify-admin`. Brands whose name is an ordinary word cannot be matched this
 * way at all, and pretending otherwise would put those domains in a public
 * table under a claim we cannot defend.
 */
const STOPWORDS = new Set([
  // infrastructure and generic product words
  "mcp",
  "api",
  "app",
  "web",
  "cloud",
  "data",
  "mail",
  "news",
  "shop",
  "store",
  "live",
  "play",
  "game",
  "team",
  "work",
  "home",
  "site",
  "page",
  "link",
  "post",
  "open",
  "next",
  "meta",
  "core",
  "base",
  "main",
  "test",
  "demo",
  "docs",
  "blog",
  "weather",
  "search",
  "email",
  "chat",
  "video",
  "photo",
  "music",
  "money",
  "admin",
  "index",
  "archive",
  "register",
  "office",
  "mobile",
  "windows",
  "android",
  "nginx",
  "apache",
  "launchpad",
  "medium",
  "oracle",
  "booking",
  "free",
  "sport",
  "focus",
  "express",
  "mirror",
  "guardian",
  "telegraph",
  "casa",
  "alice",
  "markt",
  "unifi",
  "aruba",
  "onet",
  "finn",
  "otto",
  "discovery",
  "gateway",
  "server",
  "agent",
  "tools",
  "studio",
  "space",
]);

export type Claim =
  /** Registry-verified namespace ownership. Proof. */
  | "verified_namespace"
  /** A remote endpoint on the apex itself. Proof — only the owner can host there. */
  | "endpoint_on_apex"
  /**
   * The brand's name is in the *server name* — `io.github.someone/mcp-paypal`.
   * Somebody named a server after a brand they do not control. This is the
   * shadow signal.
   */
  | "brand_in_server_name"
  /**
   * `websiteUrl` points at the apex. Almost worthless: it is usually where the
   * docs live, which is frequently GitHub, a blog post, or a vendor's page. It
   * made github.com look like the subject of 1,185 third-party claims.
   */
  | "website_url"
  /** The brand token appears in the title prose. Very weak — "supports Apple Pay". */
  | "brand_in_title";

const CONFIDENCE: Record<Claim, number> = {
  verified_namespace: 1.0,
  endpoint_on_apex: 0.95,
  brand_in_server_name: 0.6,
  website_url: 0.3,
  brand_in_title: 0.2,
};

const FIRST_PARTY_CLAIMS = new Set<Claim>(["verified_namespace", "endpoint_on_apex"]);

/**
 * Third-party claims at or above this support a shadow verdict. Set so that
 * naming a server after a brand counts, and merely mentioning the brand in
 * prose or linking to it does not — a false shadow claim is a public
 * accusation about who wrote somebody's software.
 */
const SHADOW_CONFIDENCE = 0.6;

export interface Match {
  readonly serverName: string;
  readonly namespace: string;
  readonly claim: Claim;
  readonly confidence: number;
  readonly firstParty: boolean;
  readonly endpoints: readonly string[];
}

export type Classification =
  /** Registered under first-party proof, and discoverable from the domain. */
  | "official"
  /** First-party server exists, but an agent cannot find it from the domain. */
  | "registered_undiscoverable"
  /** Discoverable card, but nothing in the registry. */
  | "orphan"
  /**
   * Third parties have named servers after this brand and no first-party
   * evidence exists. NOT publishable as-is: name matching cannot tell a genuine
   * third-party wrapper from an ordinary word collision, so every candidate
   * needs human review before it appears anywhere public.
   */
  | "shadow_candidate"
  | "absent";

interface CensusRow {
  readonly apex: string;
  readonly hasOwnCard: boolean;
}

function parseCensus(csv: string): CensusRow[] {
  const [header, ...lines] = csv.trim().split("\n");
  const cols = (header ?? "").split(",");
  const d1 = cols.indexOf("D1");

  return lines
    .map((line) => {
      const cells = line.split(",");
      return { apex: cells[0] ?? "", hasOwnCard: cells[d1] === "pass" };
    })
    .filter((r) => r.apex !== "");
}

function main(registryJson: string, censusCsv: string) {
  const registry = JSON.parse(registryJson) as RegistryEntry[];
  const censusAll = parseCensus(censusCsv);
  const census = censusAll.filter((r) => isBrandDomain(r.apex));
  const excluded = censusAll.filter((r) => !isBrandDomain(r.apex)).map((r) => r.apex);

  let githubNamespaced = 0;
  let domainNamespaced = 0;
  let deleted = 0;

  interface Indexed {
    readonly entry: RegistryEntry;
    readonly namespace: string;
    readonly namespaceDomain: string;
    readonly isGitHub: boolean;
    readonly endpoints: string[];
    readonly websiteHost: string | undefined;
    readonly serverName: string;
    readonly title: string;
  }

  const indexed: Indexed[] = [];

  for (const entry of registry) {
    const status = entry._meta?.["io.modelcontextprotocol.registry/official"]?.status;
    if (status === "deleted") {
      deleted++;
      continue;
    }

    const name = entry.server?.name ?? "";
    const namespace = name.split("/")[0] ?? "";
    if (namespace === "") continue;

    const isGitHub = isGitHubNamespace(namespace);
    if (isGitHub) githubNamespaced++;
    else domainNamespaced++;

    indexed.push({
      entry,
      namespace,
      namespaceDomain: namespaceToDomain(namespace),
      isGitHub,
      endpoints: (entry.server.remotes ?? [])
        .map((r) => hostOf(r.url))
        .filter((h): h is string => h !== undefined),
      websiteHost: hostOf(entry.server.websiteUrl),
      // Split deliberately: the server name is a deliberate act of naming, the
      // title is prose that mentions all sorts of things.
      serverName: (name.split("/")[1] ?? "").toLowerCase(),
      title: (entry.server.title ?? "").toLowerCase(),
    });
  }

  const results = census.map((row) => {
    const { apex } = row;
    const token = brandToken(apex);
    const seen = new Set<string>();
    const matches: Match[] = [];

    for (const item of indexed) {
      let claim: Claim | undefined;

      const namable = token.length >= 4 && !STOPWORDS.has(token);
      const boundary = namable ? new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`) : undefined;

      if (!item.isGitHub && isControlledBy(item.namespaceDomain, apex)) {
        claim = "verified_namespace";
      } else if (item.endpoints.some((h) => isControlledBy(h, apex))) {
        claim = "endpoint_on_apex";
      } else if (boundary?.test(item.serverName) === true) {
        claim = "brand_in_server_name";
      } else if (item.websiteHost !== undefined && isControlledBy(item.websiteHost, apex)) {
        claim = "website_url";
      } else if (boundary?.test(item.title) === true) {
        claim = "brand_in_title";
      }

      if (claim === undefined) continue;

      // The registry carries a row per version; collapse to one per server.
      const key = `${item.entry.server.name}|${claim}`;
      if (seen.has(key)) continue;
      seen.add(key);

      matches.push({
        serverName: item.entry.server.name,
        namespace: item.namespace,
        claim,
        confidence: CONFIDENCE[claim],
        firstParty: FIRST_PARTY_CLAIMS.has(claim),
        endpoints: item.endpoints,
      });
    }

    const firstParty = matches.filter((m) => m.firstParty);
    const thirdParty = matches.filter((m) => !m.firstParty && m.confidence >= SHADOW_CONFIDENCE);

    let classification: Classification;
    if (firstParty.length > 0) {
      classification = row.hasOwnCard ? "official" : "registered_undiscoverable";
    } else if (row.hasOwnCard) {
      classification = "orphan";
    } else if (thirdParty.length > 0) {
      classification = "shadow_candidate";
    } else {
      classification = "absent";
    }

    return {
      apex,
      classification,
      hasOwnCard: row.hasOwnCard,
      firstPartyCount: firstParty.length,
      thirdPartyCount: thirdParty.length,
      matches: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 25),
    };
  });

  return {
    registry: {
      total: registry.length,
      active: indexed.length,
      deleted,
      githubNamespaced,
      domainNamespaced,
    },
    census: { considered: census.length, excludedNotABrand: excluded },
    results,
  };
}

const report = main(
  await readFile(values.registry as string, "utf8"),
  await readFile(values.census as string, "utf8"),
);

await writeFile(values.out as string, `${JSON.stringify(report, null, 1)}\n`, "utf8");

const byClass = new Map<string, number>();
for (const r of report.results)
  byClass.set(r.classification, (byClass.get(r.classification) ?? 0) + 1);

const r = report.registry;
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;

process.stderr.write(
  [
    "",
    `Registry:  ${r.total} entries, ${r.active} active, ${r.deleted} deleted`,
    `  GitHub-account namespaces (io.github.*): ${r.githubNamespaced} (${pct(r.githubNamespaced, r.active)})`,
    `  Domain-verified namespaces:              ${r.domainNamespaced} (${pct(r.domainNamespaced, r.active)})`,
    "",
    `Census brands considered: ${report.census.considered}`,
    `  excluded as not-a-brand: ${report.census.excludedNotABrand.join(", ") || "(none)"}`,
    "",
    ...[...byClass]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k.padEnd(26)} ${String(v).padStart(4)}`),
    "",
    `wrote ${values.out}`,
    "",
  ].join("\n"),
);
