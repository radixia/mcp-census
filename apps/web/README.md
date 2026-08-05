# web

Templates and static assets served by the Worker. Not a workspace package and not a
build step: the Worker imports from here directly and renders server-side.

There is no SPA framework and no client-side router. Thousands of per-domain
permalinks need to be crawlable and fast, so pages are server-rendered from D1 with
the Cache API and `stale-while-revalidate`. Charts are inline SVG generated on the
server — no chart library, and no client JS beyond what the scan form on
`/census/check` strictly needs.

Every page must render with JavaScript disabled.

The visual design mirrors the existing radixia.ai design system — tokens, light and
dark, type scale — rather than inventing a new look. This has to read as part of the
site, not a bolt-on. Fetch a couple of live pages and match them.

## Content Security Policy

The Worker emits its own complete security headers, because the main site's
build-time CSP hashes are computed from pages the build produces and can never cover
Worker-rendered HTML. The policy allows **no inline script and no inline style** —
see `apps/worker/src/security.ts`. Stylesheets and scripts must be served as
separate `self` assets. Inline `<svg>` is markup rather than an image and is
unaffected.

Nothing here yet; pages land in Phase 6.
