/**
 * The one place a public URL is defined. Nothing anywhere else in this repo may
 * build a census URL by string concatenation.
 *
 * `www` is canonical. A zone Redirect Rule 301s the apex to `www` before a
 * request ever reaches the Worker, but application-side discipline still
 * matters: a mailed, printed or badge-embedded URL is never re-canonicalised.
 */
export const CANONICAL_ORIGIN = "https://www.radixia.ai";

/** Path prefix the census Worker is routed on. */
export const CENSUS_BASE_PATH = "/census";

export const CENSUS_BASE_URL = `${CANONICAL_ORIGIN}${CENSUS_BASE_PATH}`;

/**
 * Vanity domain. Public-facing name on stickers, badges and CLI output; 301s to
 * CENSUS_BASE_URL. Never used to build a link we render ourselves.
 */
export const VANITY_DOMAIN = "mcpcensus.dev";

/**
 * Whether search engines may index the census.
 *
 * **Currently false.** The site is live on the real domain so it can be built
 * and reviewed against real data, but it must not appear in search results
 * before the launch on 2026-09-17. Until then every response carries
 * `X-Robots-Tag: noindex, nofollow, noarchive` and every page carries the
 * matching meta tag.
 *
 * Deliberately `noindex` rather than a `robots.txt` disallow: a crawler has to
 * fetch a page to see a noindex, so blocking the crawl would leave already-known
 * URLs indexed with no way to tell anyone to drop them. Blocking in robots.txt
 * is also impossible here — `/robots.txt` belongs to the static site, whose
 * build we do not touch.
 *
 * **To go live: set this to `true`, deploy, and delete the test that asserts it
 * is false.** That test exists so nobody ships an indexable census by accident.
 */
export const SEARCH_INDEXING_ENABLED = false;

/** Applied to every response while indexing is disabled. */
export const NOINDEX_HEADER = "noindex, nofollow, noarchive";

/**
 * Build an absolute census URL. Use this instead of template literals so the
 * canonical host is enforced in exactly one place.
 *
 * @param path Path relative to the census root, with or without a leading `/`.
 */
export function censusUrl(path = "/"): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${CENSUS_BASE_PATH}${suffix === "/" ? "/" : suffix}`, CANONICAL_ORIGIN);
  return url.toString();
}
