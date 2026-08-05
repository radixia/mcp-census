# web

The templates and stylesheet now live with the Worker, at
`apps/worker/src/web/`.

They were moved there because `apps/web` was not a workspace package, so
importing it from the Worker broke both `rootDir` and the resolution of
`@mcp-census/core`. The alternatives were to make this a fourth package or to
put the templates where their only consumer already is. The second is fewer
moving parts, which is the standing tie-breaker for this project.

- `apps/worker/src/web/styles.ts` — the stylesheet, served at
  `/census/assets/census.css`. An external sheet rather than inline style,
  because the Worker's CSP is `style-src 'self'` with no `unsafe-inline`.
  Tokens are lifted from the live radixia.ai so the census reads as part of the
  site.
- `apps/worker/src/web/layout.ts` — the HTML shell, escaping, and inline-SVG
  charts. No chart library.
- `apps/worker/src/web/pages.ts` — one pure function per page.

Every page is server-rendered and must work with JavaScript disabled; there is
no client script anywhere, and a test asserts it stays that way.
