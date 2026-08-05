import { CENSUS_VERSION, censusUrl, METHODOLOGY_VERSION } from "@mcp-census/core";

/**
 * The verb lives in the subcommand so that `compare` and `badge` can be added
 * later without redesigning the interface.
 */
export const SUBCOMMANDS = ["check"] as const;

export type Subcommand = (typeof SUBCOMMANDS)[number];

export function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

/**
 * Accepts what a person would type — a bare domain, a pasted URL, a host with a
 * port — and returns a bare apex. Shared with the website so both agree.
 */
export function normaliseDomain(input: string): string | undefined {
  let value = input.trim().toLowerCase();
  if (value === "") return undefined;

  value = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const slash = value.indexOf("/");
  if (slash !== -1) value = value.slice(0, slash);
  const colon = value.indexOf(":");
  if (colon !== -1) value = value.slice(0, colon);

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return undefined;
  }
  return value.length > 253 ? undefined : value;
}

export function usage(): string {
  return [
    `mcpcensus ${CENSUS_VERSION}  (methodology ${METHODOLOGY_VERSION})`,
    "",
    "Usage:",
    "  mcpcensus check <domain> [--json] [--all]",
    "",
    "Options:",
    "  --json        Machine-readable output, the same shape the dataset uses",
    "  --all         Show full evidence for every check",
    "  --no-colour   Never colourise, even on a terminal",
    "  --version     Print the version",
    "",
    "Exit codes:",
    "  0  measured",
    "  2  not assessable \u2014 robots.txt excluded us, or the domain was unreachable",
    "",
    `Methodology: ${censusUrl("/methodology")}`,
    `Crawler ethics: ${censusUrl("/crawler")}`,
  ].join("\n");
}
