#!/usr/bin/env node
import { isSubcommand, usage } from "./usage.js";

/**
 * Phase 0 wiring only. The `check` implementation lands in Phase 2, on top of
 * the probes built in Phase 1.
 */
function main(argv: readonly string[]): number {
  const [subcommand] = argv;

  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(`${usage()}\n`);
    return subcommand === undefined ? 1 : 0;
  }

  if (!isSubcommand(subcommand)) {
    process.stderr.write(`unknown subcommand: ${subcommand}\n\n${usage()}\n`);
    return 1;
  }

  process.stderr.write("mcpcensus check is not implemented yet (lands in Phase 2).\n");
  return 70;
}

process.exitCode = main(process.argv.slice(2));
