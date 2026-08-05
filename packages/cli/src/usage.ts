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

export function usage(): string {
  return [
    `mcpcensus ${CENSUS_VERSION}  (methodology ${METHODOLOGY_VERSION})`,
    "",
    "Usage:",
    "  mcpcensus check <domain> [--json] [--all]",
    "",
    "Options:",
    "  --json   Machine-readable output",
    "  --all    Show full evidence for every check, not just failures",
    "",
    `Methodology: ${censusUrl("/methodology")}`,
    `Crawler ethics: ${censusUrl("/crawler")}`,
  ].join("\n");
}
