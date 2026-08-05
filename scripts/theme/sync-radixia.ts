/**
 * Generate the Radixia theme from @radixia/brand.
 *
 *   node theme/sync-radixia.ts            # regenerate
 *   node theme/sync-radixia.ts --check    # fail if the committed file is stale
 *
 * The brand package is a devDependency, never a runtime one: this repository is
 * open source and a fork must not have to pull Radixia's package to build. The
 * generated theme is committed so that `pnpm build` works from a clean clone, and
 * `--check` runs in CI so a brand release cannot drift away from it unnoticed.
 *
 * Generating rather than hand-writing is the whole point. The census's original
 * stylesheet was written by reading the live site and retyping the values, and
 * within a day it had lost four tokens, put buttons on the card radius, and kept
 * a pre-accessibility --ink-3 at 4.37:1. Values that are copied by hand decay;
 * values that are derived cannot.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { check: { type: "boolean", default: false } },
  allowPositionals: true,
});

const BRAND = "../node_modules/@radixia/brand";
const OUT = "../packages/core/src/theme/radixia.ts";

/**
 * Brand token -> census token. The census needs a smaller vocabulary than the
 * website, and it deliberately renames the accent: structural CSS that says
 * `--accent` can be re-themed by anyone, whereas `--magenta` only makes sense for
 * one brand.
 */
const MAP: ReadonlyArray<readonly [brand: string, census: string]> = [
  ["font-body", "font-body"],
  ["font-display", "font-display"],
  ["font-mono", "font-mono"],
  ["paper", "paper"],
  ["paper-2", "paper-2"],
  ["card", "card"],
  ["ink", "ink"],
  ["ink-2", "ink-2"],
  ["ink-3", "ink-3"],
  ["line", "line"],
  ["magenta", "accent"],
  ["magenta-deep", "accent-deep"],
  ["magenta-btn", "accent-btn"],
  ["magenta-btn-hover", "accent-btn-hover"],
  ["radius", "radius"],
  ["radius-btn", "radius-btn"],
];

/**
 * Census-only additions, which the brand has no opinion about.
 *
 * `w-max` is NOT taken from the brand's 1240px: the census is tables and prose,
 * and long rows at that width are hard to read. The brand's own --w-prose (720px)
 * is too narrow for the results table. 960px is a census decision, recorded here
 * rather than buried in the structural CSS.
 *
 * The status colours are the census's own. Contrast measured against --paper and
 * --card in both schemes; all clear WCAG AA.
 */
const CENSUS_ONLY = {
  light: { "w-max": "960px", ok: "#1b7f4b", warn: "#a86b00", bad: "#9c2b2b" },
  dark: { ok: "#4fd18b", warn: "#e8b04b", bad: "#ff8f8f" },
} as const;

/**
 * Radixia's call to action. Hand-maintained here rather than derived, because the
 * brand package has no opinion about what the census sells.
 *
 * Deliberately flat in tone. The census's whole standing rests on being a
 * measurement rather than a scare, so this offers help with a fact and does not
 * imply a threat. If this copy ever starts sounding like a security warning,
 * that is a bug.
 *
 * `/enterprise-ai` and not `/capabilities/ai-architecture`: the latter 404s on the
 * currently deployed site and only exists on the content-2026-09 branch, whereas
 * /enterprise-ai answers 200 today and redirects to the new page once that branch
 * ships. It is the one URL that is correct before and after the deploy.
 */
const CTA = {
  heading: "Would you rather this said something else?",
  body:
    "Radixia designs and runs the plumbing that makes a brand reachable by agents " +
    "\u2014 MCP servers, discovery documents, and the boring parts that decide whether " +
    "any of it can be found. We are in this dataset too.",
  label: "How we work",
  url: "https://www.radixia.ai/enterprise-ai",
} as const;

interface BrandTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}

function pick(source: Record<string, string>, onlyChanged?: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [brand, census] of MAP) {
    const value = source[brand];
    if (value === undefined) throw new Error(`@radixia/brand has no --${brand}`);
    // For the dark block, emit only what actually differs from light.
    if (onlyChanged !== undefined && onlyChanged[brand] === value) continue;
    out[census] = value;
  }
  return out;
}

const literal = (o: Record<string, string>, indent: string) =>
  Object.entries(o)
    .map(([k, v]) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");

async function main(): Promise<void> {
  const pkg = JSON.parse(await readFile(`${BRAND}/package.json`, "utf8")) as { version: string };
  const brand = JSON.parse(await readFile(`${BRAND}/tokens/tokens.json`, "utf8")) as BrandTokens;
  const fontFaces = (await readFile(`${BRAND}/css/fonts-absolute.css`, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

  const light = { ...pick(brand.light), ...CENSUS_ONLY.light };
  const dark = { ...pick(brand.dark, brand.light), ...CENSUS_ONLY.dark };

  const source = `/**
 * GENERATED by scripts/theme/sync-radixia.ts from @radixia/brand@${pkg.version}.
 * Do not edit. Run \`pnpm theme:sync\` after upgrading the brand package.
 *
 * Radixia's own skin for the census. It is one theme among several and is NOT the
 * default — see neutral.ts for why a fork must not inherit somebody else's
 * identity.
 *
 * \`@font-face\` uses absolute /fonts/ URLs, which resolve only on an origin that
 * serves them. That is true of www.radixia.ai and false everywhere else, which is
 * the other reason this theme is not the default.
 */

import type { CensusTheme } from "./types.js";

/** The brand release these values were derived from. Asserted by \`pnpm theme:sync --check\`. */
export const RADIXIA_BRAND_VERSION = ${JSON.stringify(pkg.version)};

const FONT_FACES = ${JSON.stringify(fontFaces)};

/** Radixia's pitch. Kept factual: this is a measurement, not a warning. */
const CTA = ${JSON.stringify(CTA, null, 2).replace(/\n/g, "\n")};

export const RADIXIA_THEME: CensusTheme = {
  id: "radixia",
  // The site writes a manual light/dark override; census pages honour it.
  honourDataTheme: true,
  fontFaces: FONT_FACES,
  tokens: {
${literal(light, "    ")}
  },
  darkTokens: {
${literal(dark, "    ")}
  },
  branding: {
    productName: "MCP Census",
    operator: { name: "Radixia", url: "https://www.radixia.ai" },
    repoUrl: "https://github.com/radixia/mcp-census",
    // radixia.ai is in this dataset and never excluded from it.
    inOwnDataset: true,
    cta: CTA,
  },
};
`;

  if (values.check === true) {
    const current = await readFile(OUT, "utf8").catch(() => null);
    if (current !== source) {
      process.stderr.write(
        `${OUT} is stale against @radixia/brand@${pkg.version}.\n\nRun: pnpm theme:sync\n`,
      );
      process.exit(1);
    }
    process.stderr.write(`theme in sync with @radixia/brand@${pkg.version}\n`);
    return;
  }

  await writeFile(OUT, source, "utf8");
  process.stderr.write(
    `wrote ${OUT}\n  brand ${pkg.version}: ${Object.keys(light).length} tokens, ${Object.keys(dark).length} dark overrides\n`,
  );
}

await main();
