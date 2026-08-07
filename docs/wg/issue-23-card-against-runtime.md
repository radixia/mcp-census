# Draft comment — experimental-ext-server-card#23

**Status: not posted.** Marco's call, and his direct contact with the WG comes
first. See [`outreach.md`](outreach.md).

**Target:** [#23 — Add a normative requirement that a Server Card MUST NOT
contradict the server's actual runtime behavior](https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/23)
(closed COMPLETED 2026-06-08).

**Why this one first:** it is the only one of the three that is a MUST, and we
can find no measurement of it.

---

## Some data on the requirement this issue added

We run [MCP Census](https://www.radixia.ai/census/), an open measurement of
whether an agent can discover and reach an MCP server starting from a bare
domain. The population is 7,422 organisations the MCP Registry shows run a
server. Everything below comes from one run on 2026-08-07, published in full at
`/census/data`, methodology `0.4.0`. We are in our own dataset and say so.

This issue made it normative that a card must not contradict its server. We hold
both sides for any domain where a card was found and an unauthenticated
handshake succeeded, so we compared them. No extra request: it is a comparison
of responses already collected.

**Denominator: 478 domains** where a card and a handshake both exist and share at
least one comparable field. Not the population — most domains have neither.

| | count | of 478 |
|---|---:|---:|
| card contradicts the server | **120** | 25.1% |
| … on `version` | 103 | 21.5% |
| … on `protocolVersion` | 20 | 4.2% |
| `name` differs (see below — not counted as a contradiction) | 135 | 28.2% |

A `protocolVersion` conflict means the card declared a set of revisions that did
not contain the one the server negotiated. A client trusting the card would form
the wrong expectation about a server it can in fact talk to.

## The part we think matters more than the percentage

**The two values are not drifting apart. They are unrelated.**

Of the 103 `version` conflicts, **43 have the card ahead of the server and 51
behind**. If cards simply went stale while deployments moved on, almost all would
be behind. They are not: the card and the running server are maintained in
different places by different processes, and nothing connects them in either
direction.

That suggests the gap this issue closed in the specification is not closed in
practice, and would not be closed by stronger wording. A publisher who wants to
comply currently has no way to notice that they do not. Whatever mechanism might
help — a conformance hint in the SDKs, a field the server can echo, a documented
check — is a separate question from the normative text, and this data is the
argument for asking it.

## `name` is excluded, and that is a second finding

We do **not** count a differing `name` as a contradiction, because we do not
believe those publishers are in breach. Two real examples from the run:

- a card carrying a human display name against a runtime reporting
  `genesis-directory`
- a card reading `<brand> MCP Server` against a runtime reporting
  `magento-mcp-server`

The card's `name` and the handshake's `serverInfo.name` have no shared declared
meaning. One is a label for a person, the other identifies a software package.
Under the requirement as written, **a conforming publisher can be in breach of it
through no fault**, and 28.2% of the comparable set looks like that.

We also treat a containment relation as agreement — `io.github.acme/weather`
against `weather` is a naming convention, not a conflicting claim — otherwise the
number would be much larger and much less honest.

**Question:** would it help to say which fields are normatively comparable? Our
reading is that `version` and `protocolVersion` are unambiguous and `name` is
not, but that is a reading, and you would know.

## What we did not do

We publish the verdict per field and never the values. Which organisations carry
a card that disagrees with their server is a finding about the ecosystem; a table
pairing a brand with the words its server contradicts is a different thing, and
not one we want to publish. If specific cases would be useful to the WG we can
share them privately, or ask the operators.

The comparison, the population and the run are all in the open release, so the
number can be checked rather than taken from us.
