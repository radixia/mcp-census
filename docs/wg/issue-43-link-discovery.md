# Draft comment — experimental-ext-server-card#43

**Status: not posted.** See [`outreach.md`](outreach.md).

**Target:** [#43 — Support Link header and HTML `<link>` catalog discovery, not
just /.well-known](https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/43)
(open since 2026-07-20).

**Why:** it is an open design question with no data attached, and it is
answerable by measurement.

---

## How much the well-known path misses

Same run as our other comment: 7,422 domains from the MCP Registry, 2026-08-07,
methodology `0.4.0`, published at `/census/data`.

Until this month we probed `/.well-known/ai-catalog.json` and nothing else, which
is exactly the gap this issue describes. We added a check that reads the domain's
root document — the `Link` header and `<link>` elements in the `<head>` — and
re-ran.

| | count |
|---|---:|
| answered at `/.well-known/ai-catalog.json` | 132 |
| advertise a catalog from the root document | 81 |
| … somewhere the well-known path does not cover | 55 |
| … **and have no well-known document at all** | **46** |

So of the 178 domains where a catalog is discoverable by either route,
**46 — about a quarter — are invisible to a client that only tries the
well-known path.**

The two tables below count **advertisements, not domains** — 93 of them across
those 81 domains, since a domain can advertise in both places.

Where the advertisement lives:

| source | advertisements |
|---|---:|
| `Link` header | 59 |
| HTML `<link>` | 34 |

And what it points at, relative to the domain:

| target | advertisements |
|---|---:|
| same origin, some other path | 53 |
| the well-known path itself | 34 |
| a subdomain | 5 |
| a third party | 1 |

The 34 pointing at the well-known path are a useful confirmation rather than a
finding: those publishers advertised a location a well-known-only client would
have reached anyway. The domain-level figures in the first table are the ones to
read — 55 domains advertising somewhere the fallback does not cover, 46 of them
with nothing at the fallback at all.

## Caveats we would rather state than have found

- **This is a floor.** We read the root document only. A catalog advertised from
  a documentation page, a developer portal or any other URL is outside what we
  measure, and we say so on every page that quotes the figure.
- **`HEAD` on the interactive check.** Our public per-domain checker uses `HEAD`
  and reads the header only, so it sees the 59 and not the 34. The batch crawl
  does the full `GET`. The two profiles are labelled distinctly in the output.
- **We record the advertisement, never the URL, and we never fetch it.**
  Following an address a publisher chooses, from an unattended crawler visiting
  thousands of domains, is a request-forgery surface with no upside for a
  census. The target is recorded as a relation — same origin, subdomain, third
  party — which is also why the table above exists in that shape.

## The question

Is a quarter enough to make the `Link` and `<link>` routes worth supporting in
the extension, or is the well-known fallback judged sufficient for the client
profile you have in mind?

Either answer is useful to us, and we will keep measuring it either way: the
series will show whether the ratio moves as the extension settles.

If synthetic fixtures for these cases would help the client best-practices work
in #40, we would rather build the ones you want than guess. Source precedence,
cross-origin provenance, redirects, media type, cache revalidation, multi-card —
which of those is actually blocking?
