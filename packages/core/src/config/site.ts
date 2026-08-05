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
