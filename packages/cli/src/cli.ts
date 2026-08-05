#!/usr/bin/env node
import { parseArgs } from "node:util";

import {
  GuardedHttpClient,
  ProbeGuardError,
  probeDomain,
  resolveCrawlerIdentity,
} from "@mcp-census/core";

import { nodeFetch, nodeResolveTxt, sleep } from "./adapters.js";
import { humanReport, jsonReport } from "./report.js";
import { isSubcommand, normaliseDomain, usage } from "./usage.js";

async function check(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      json: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      "no-colour": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const target = positionals[0];
  if (target === undefined) {
    process.stderr.write("mcpcensus check <domain>\n");
    return 1;
  }

  const apex = normaliseDomain(target);
  if (apex === undefined) {
    process.stderr.write(`not a domain name: ${target}\n`);
    return 1;
  }

  const deps = { fetch: nodeFetch(), sleep, now: () => Date.now() };

  try {
    const client = new GuardedHttpClient(deps, {
      apex,
      // Throws unless a live opt-out contact is configured, so the CLI cannot
      // reach a third party without publishing a route to be excluded.
      identity: resolveCrawlerIdentity(),
      optOuts: new Set<string>(),
    });

    const result = await probeDomain(
      { client, now: () => Date.now(), resolveTxt: nodeResolveTxt() },
      { apex },
    );

    if (values.json === true) {
      process.stdout.write(`${jsonReport(result)}\n`);
    } else {
      // Colour only when stdout is a terminal, so piping stays clean.
      const colour = values["no-colour"] !== true && process.stdout.isTTY === true;
      process.stdout.write(humanReport(result, { all: values.all === true, colour }));
    }

    // A domain we were not allowed to measure is not a failure of the domain,
    // but it is not a successful measurement either. 2 says so without
    // pretending we found something.
    return result.score.assessed ? 0 : 2;
  } catch (error) {
    if (error instanceof ProbeGuardError) {
      process.stderr.write(`refusing to continue: ${error.rule}: ${error.message}\n`);
      return 70;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(`${usage()}\n`);
    return subcommand === undefined ? 1 : 0;
  }
  if (subcommand === "--version" || subcommand === "-v") {
    const { CENSUS_VERSION } = await import("@mcp-census/core");
    process.stdout.write(`${CENSUS_VERSION}\n`);
    return 0;
  }
  if (!isSubcommand(subcommand)) {
    process.stderr.write(`unknown subcommand: ${subcommand}\n\n${usage()}\n`);
    return 1;
  }

  return check(rest);
}

process.exitCode = await main(process.argv.slice(2));
