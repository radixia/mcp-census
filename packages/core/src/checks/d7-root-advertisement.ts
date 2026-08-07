/**
 * `D7` — a catalog advertised from the domain's own root document.
 *
 * The AI Catalog specification does not treat `/.well-known/ai-catalog.json` as
 * the way to find a catalog. A catalog is identified by its media type rather
 * than its path, it may be served from any URL, and the well-known location is
 * explicitly optional. The discovery procedure consults an HTTP `Link` header
 * and an HTML `<link>` element *before* falling back to the well-known path, and
 * until this check every census figure we published came from the fallback alone.
 *
 * The extension repository has that gap open as
 * https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/43,
 * with no data attached. This check is the data: how many domains advertise a
 * catalog in a way a conforming client would find and our well-known probe would
 * miss.
 *
 * **We record the advertisement. We never fetch it.** Following an advertised URL
 * would put a fetcher of third-party-controlled URLs inside a batch crawler that
 * visits thousands of domains unattended, which is a server-side request forgery
 * surface we have no reason to build. For the same reason the target is recorded
 * as a *relation* to the apex and never as a URL: a publisher could otherwise
 * choose any string and have us republish it under CC-BY.
 *
 * **Not scored.** `scoreDomain` ignores `D7` in methodology 0.4.0. An
 * advertisement is not a confirmed document — we deliberately did not open it —
 * so counting it as discovery would inflate the headline on evidence we chose
 * not to collect. It is published as a measurement beside the score, not inside
 * it.
 */

import { headerValue, MAX_PARSEABLE_BODY_BYTES } from "../http/types.js";
import type { CheckContext, CheckDeps } from "./deps.js";
import { classifyStatus } from "./outcome.js";
import { type CheckResult, errored, fail, pass, skip } from "./types.js";

/** Link relations that name a catalog. Lower-cased before matching. */
const CATALOG_RELS = ["ai-catalog", "mcp-server-card", "mcp-catalog"] as const;

/** Where an advertised target sits relative to the domain we are measuring. */
export type TargetRelation =
  /** The advertisement points at the path our well-known probe already covers. */
  | "well_known_path"
  | "same_origin"
  | "subdomain"
  | "third_party"
  /** `javascript:`, `data:` and friends. Advertised, but not a fetchable catalog. */
  | "not_http"
  /** Defensive. With a valid base almost nothing fails to parse, so this is rare. */
  | "malformed";

export interface Advertisement {
  readonly source: "link_header" | "html_link";
  readonly rel: string;
  readonly relation: TargetRelation;
}

const WELL_KNOWN = "/.well-known/ai-catalog.json";

export function relationOf(href: string, apex: string): TargetRelation {
  let url: URL;
  try {
    url = new URL(href, `https://${apex}/`);
  } catch {
    return "malformed";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "not_http";

  const host = url.hostname.toLowerCase();
  if (host !== apex && !host.endsWith(`.${apex}`)) return "third_party";
  if (host !== apex) return "subdomain";
  return url.pathname === WELL_KNOWN ? "well_known_path" : "same_origin";
}

/**
 * Parse an RFC 8288 `Link` header.
 *
 * Deliberately small: we need the relation and the target of entries whose `rel`
 * names a catalog, and nothing else. Quoted and unquoted `rel` both occur.
 */
export function parseLinkHeader(header: string, apex: string): Advertisement[] {
  const out: Advertisement[] = [];
  for (const entry of header.split(/,(?=\s*<)/)) {
    const target = /<([^>]*)>/.exec(entry);
    if (target?.[1] === undefined) continue;
    const rel = /;\s*rel\s*=\s*("([^"]*)"|([^;,\s]+))/i.exec(entry);
    const value = (rel?.[2] ?? rel?.[3] ?? "").toLowerCase();
    if (!value) continue;
    for (const token of value.split(/\s+/)) {
      if (!CATALOG_RELS.includes(token as (typeof CATALOG_RELS)[number])) continue;
      out.push({ source: "link_header", rel: token, relation: relationOf(target[1], apex) });
    }
  }
  return out;
}

/**
 * Pull catalog `<link>` elements out of an HTML head.
 *
 * A regex rather than a parser because the alternative is shipping an HTML
 * parser into a Worker to read one element, and because we stop at `</head>`:
 * anything below it is page content we have no business reading.
 */
export function parseHtmlLinks(body: string, apex: string): Advertisement[] {
  const headEnd = body.toLowerCase().indexOf("</head>");
  const head = headEnd === -1 ? body.slice(0, 64 * 1024) : body.slice(0, headEnd);
  const out: Advertisement[] = [];

  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const relValue = (rel?.[2] ?? rel?.[3] ?? rel?.[4] ?? "").toLowerCase();
    const hrefValue = href?.[2] ?? href?.[3] ?? href?.[4];
    if (!relValue || hrefValue === undefined) continue;
    for (const token of relValue.split(/\s+/)) {
      if (!CATALOG_RELS.includes(token as (typeof CATALOG_RELS)[number])) continue;
      out.push({ source: "html_link", rel: token, relation: relationOf(hrefValue, apex) });
    }
  }
  return out;
}

/**
 * `headerOnly` trades coverage for weight, and the trade is measured.
 *
 * In the first full run the advertisements split 59 to the `Link` header and 34
 * to an HTML `<link>`, so a `HEAD` sees about two thirds of them and downloads
 * no page at all. That is the right side of the trade for the on-demand check,
 * which any stranger can point at any domain: a home page is usually the
 * heaviest, least cacheable thing a site serves, and we have no business holding
 * a page of somebody else's HTML that a visitor asked us to fetch.
 *
 * The batch crawler keeps the full `GET`. Its population is frozen, nobody can
 * aim it, and the missing third of the signal is the whole reason the check
 * exists.
 */
export interface RootAdvertisementOptions {
  readonly headerOnly?: boolean;
}

export async function checkRootAdvertisement(
  deps: CheckDeps,
  context: CheckContext,
  options: RootAdvertisementOptions = {},
): Promise<CheckResult> {
  const started = deps.now();
  const headerOnly = options.headerOnly === true;
  const outcome = await deps.client.fetchPath("/", headerOnly ? "HEAD" : "GET");
  const latencyMs = () => deps.now() - started;

  if (outcome.outcome === "skipped_by_robots") {
    return skip("D7", "skipped_by_robots", latencyMs());
  }
  if (outcome.outcome === "transport_error") {
    return errored("D7", outcome.error, latencyMs());
  }
  if (outcome.outcome === "redirect_off_apex") {
    return fail("D7", { result: "redirected_off_apex", advertisements: [] }, latencyMs());
  }

  const { response } = outcome;
  if (response.status < 200 || response.status >= 300) {
    return fail(
      "D7",
      { result: classifyStatus(response.status), status: response.status, advertisements: [] },
      latencyMs(),
    );
  }

  const advertisements: Advertisement[] = [];

  const link = headerValue(response, "link");
  if (link !== undefined) advertisements.push(...parseLinkHeader(link, context.apex));

  const contentType = headerValue(response, "content-type") ?? "";
  if (
    !headerOnly &&
    contentType.includes("html") &&
    response.body.length <= MAX_PARSEABLE_BODY_BYTES
  ) {
    advertisements.push(...parseHtmlLinks(response.body, context.apex));
  }

  const evidence = {
    status: response.status,
    advertisements,
    // In the data, not only in the interface. A reader comparing two rows must
    // be able to see that one of them could not have found an HTML `<link>`.
    ...(headerOnly ? { headerOnly: true } : {}),
    // The number the working group is missing: advertised somewhere other than
    // the path our well-known probe covers.
    beyondWellKnown: advertisements.some((a) => a.relation !== "well_known_path"),
  };

  return advertisements.length > 0
    ? pass("D7", evidence, latencyMs())
    : fail("D7", evidence, latencyMs());
}
