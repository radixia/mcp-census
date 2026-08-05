/**
 * Pull the entire official MCP Registry to a local snapshot.
 *
 * The registry is explicitly in preview with "no uptime or data durability
 * guarantees" and may reset, so every run writes a timestamped snapshot we can
 * re-analyse without re-fetching. Aggregators are asked to scrape "on a regular
 * but infrequent basis (e.g. once per hour)"; a full pull is well within that.
 *
 *   node shadow/pull.ts [--out out/registry.json]
 */

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const BASE = "https://registry.modelcontextprotocol.io";
const PAGE = 100;

const { values } = parseArgs({
  options: { out: { type: "string", default: "out/registry.json" } },
  allowPositionals: true,
});

export interface RegistryEntry {
  readonly server: {
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly version?: string;
    readonly websiteUrl?: string;
    readonly repository?: { url?: string; source?: string };
    readonly remotes?: ReadonlyArray<{ type?: string; url?: string }>;
    readonly packages?: ReadonlyArray<{ registryType?: string; identifier?: string }>;
  };
  readonly _meta?: {
    readonly "io.modelcontextprotocol.registry/official"?: {
      readonly status?: string;
      readonly publishedAt?: string;
      readonly isLatest?: boolean;
    };
  };
}

async function main(): Promise<void> {
  const all: RegistryEntry[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    const url = new URL("/v0.1/servers", BASE);
    url.searchParams.set("limit", String(PAGE));
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`registry ${response.status} on page ${page}`);

    const body = (await response.json()) as {
      servers?: RegistryEntry[];
      metadata?: { nextCursor?: string; count?: number };
    };

    const servers = body.servers ?? [];
    all.push(...servers);
    page++;
    process.stderr.write(`\rpage ${page}, ${all.length} servers`);

    cursor = body.metadata?.nextCursor;
    if (cursor === undefined || servers.length === 0) break;
  }

  process.stderr.write("\n");
  await writeFile(values.out as string, `${JSON.stringify(all, null, 1)}\n`, "utf8");
  process.stderr.write(`wrote ${all.length} servers -> ${values.out}\n`);
}

await main();
