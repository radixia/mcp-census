/**
 * Bundle the CLI into one file with no runtime dependencies.
 *
 * `@mcp-census/core` is this repository's internal machinery: its shape changes
 * with every methodology revision, and it has had five in six weeks. Publishing
 * it alongside the CLI would turn that churn into a public API contract nobody
 * asked for, and would mean a release of core for every release of this.
 *
 * So core is a devDependency, bundled in at build time. The published package is
 * one file with an empty `dependencies`, which is also the fastest possible
 * `npx mcpcensus check` — nothing to resolve.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Everything goes in. Nothing is external, because nothing is installed.
  packages: "bundle",
  // No `banner` here: src/cli.ts already starts with the shebang and esbuild
  // keeps it. Adding one produced a file with two, and a `#!` on line two is a
  // syntax error rather than a comment — the package installed cleanly and then
  // refused to run.
  legalComments: "inline",
});
