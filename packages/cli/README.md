# mcpcensus

Check whether an AI agent could discover and connect to an MCP server for a
domain — the same probe that produces [MCP Census](https://www.radixia.ai/census/).

```sh
npx mcpcensus check example.com
```

It asks only for things a domain owner published on purpose: a short, versioned
list of `.well-known` paths, a DNS `TXT` record, conventional endpoints, text
fallbacks, and — only if those already found an endpoint — one unauthenticated
JSON-RPC call. It never invokes a tool, never sends credentials, never tests for
a weakness, and honours `robots.txt` for every path.

## What the result means

A negative is not proof of absence. The probe covers a published candidate list;
a server somewhere else is a server it missed, and it says so. A refusal — 401,
403, 429, 5xx — is recorded as *inconclusive*, never as absence, because it is a
fact about the probe rather than about the domain.

Missing OAuth protected-resource metadata is never a finding: authorization is
optional in MCP, so a public unauthenticated server correctly publishes none.

## The rest

- [Methodology](https://www.radixia.ai/census/methodology), including the
  limitations — several of which describe the project's own mistakes
- [Crawler ethics](https://www.radixia.ai/census/crawler), and how to opt out
- [The open dataset](https://www.radixia.ai/census/data), CC-BY-4.0

Code is Apache-2.0. Radixia is measured in its own dataset like everyone else.
