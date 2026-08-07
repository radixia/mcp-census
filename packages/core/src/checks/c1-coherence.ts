/**
 * `C1` — does the card agree with the server that answers?
 *
 * A Server Card is fetched *before* the handshake, so a client acts on its
 * claims about identity, version and protocol before it can check any of them.
 * On 2026-06-08 the experimental extension closed
 * https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/23,
 * which added a normative requirement that a card MUST NOT contradict the
 * server's actual runtime behaviour. Before that there was no text saying the
 * card must not lie.
 *
 * It is a MUST, and as far as we can tell nobody has measured it. We already
 * hold both sides for every domain where a card was found and a handshake
 * succeeded, so this check costs **no request at all**: it is a pure function
 * over evidence two other checks already collected.
 *
 * `C` is a new family rather than a `D8`. The letters group by what is being
 * asked — `D` discovery, `Q` quality of the tool surface, `F` fallbacks and
 * posture, `S` shadow — and coherence between a declaration and a runtime is
 * none of those. Extending `D` for anything new is how a scheme of identifiers
 * stops meaning anything.
 *
 * ## What counts as a contradiction
 *
 * Not every difference is a lie, and this distinction is the whole design. A
 * registry-style name is reverse-DNS (`io.github.acme/weather`) while the same
 * server's runtime `serverInfo.name` is often the bare last segment
 * (`weather`). Those agree in substance and differ in form. Reporting them as
 * contradictions would manufacture hundreds of accusations out of a naming
 * convention, so a containment relation is recorded as `related` and only a
 * genuine disagreement is `differ`.
 *
 * ## `name` is not a contradiction, and that is the finding
 *
 * The first six domains measured showed the pattern: `aclimacao.sampa.br` puts
 * "Aclimação" on the card and answers `genesis-directory`; `123elec.com` puts
 * "123elec MCP Server" and answers `magento-mcp-server`. Neither publisher is
 * lying. The card carries a human display name and the handshake reports the
 * software package, and no specification says those are the same field.
 *
 * So `name` is measured and reported as **divergence**, never as a
 * contradiction, and it cannot fail the check. Only `version` and
 * `protocolVersion` — where both sides mean the same thing — can. The divergence
 * count is the more useful number of the two: it says the MUST added by #23 is
 * ambiguous on `name`, and a conforming publisher can trip it through no fault.
 *
 * We publish the verdict per field and never the values. Which domains carry a
 * stale card is a finding about the ecosystem; a public table pairing a brand
 * with the words its server contradicts is a pillory, and the brief rules that
 * out.
 */

import type { CheckId, CheckResult } from "./types.js";
import { fail, pass, skip } from "./types.js";

export type CoherenceVerdict =
  /** Equal once trimmed and lower-cased. */
  | "agree"
  /** One contains the other. A naming convention, not a contradiction. */
  | "related"
  /** Both present, neither contains the other. This is the reportable case. */
  | "differ";

export interface FieldComparison {
  readonly field: "name" | "version" | "protocolVersion";
  readonly verdict: CoherenceVerdict;
}

export interface CardIdentity {
  readonly name?: string;
  readonly version?: string;
  /** Protocol revisions the card claims to support. */
  readonly protocolVersions?: readonly string[];
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

/**
 * Pull identity out of a card, whatever shape it happens to be.
 *
 * The same spread of formats `endpointFromCard` deals with: a `serverInfo`
 * object, a flat registry-style document, and a handful of one-off shapes. A
 * catalog document describing many servers is deliberately not handled — it
 * names other people's servers, and comparing one of them against this domain's
 * handshake would compare two unrelated things.
 */
export function identityFromCard(document: Record<string, unknown>): CardIdentity {
  const info = asRecord(document.serverInfo);

  const name = str(info?.name) ?? str(document.name);
  const version = str(info?.version) ?? str(document.version);

  const declared = new Set<string>();
  for (const key of ["protocolVersion", "mcpVersion", "protocolVersions", "supportedVersions"]) {
    const value = document[key];
    if (typeof value === "string") {
      const v = str(value);
      if (v !== undefined) declared.add(v);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        const v = str(item);
        if (v !== undefined) declared.add(v);
      }
    }
  }

  return {
    ...(name === undefined ? {} : { name }),
    ...(version === undefined ? {} : { version }),
    ...(declared.size === 0 ? {} : { protocolVersions: [...declared] }),
  };
}

export function compareText(declared: string, observed: string): CoherenceVerdict {
  const a = declared.trim().toLowerCase();
  const b = observed.trim().toLowerCase();
  if (a === b) return "agree";
  // `io.github.acme/weather` against `weather`: a convention, not a claim in
  // conflict. Both directions, because either side may be the qualified one.
  if (a.includes(b) || b.includes(a)) return "related";
  return "differ";
}

export interface RuntimeIdentity {
  readonly name?: string;
  readonly version?: string;
  readonly negotiatedVersion?: string;
}

export function compareIdentity(
  card: CardIdentity,
  runtime: RuntimeIdentity,
): readonly FieldComparison[] {
  const out: FieldComparison[] = [];

  if (card.name !== undefined && runtime.name !== undefined) {
    out.push({ field: "name", verdict: compareText(card.name, runtime.name) });
  }
  if (card.version !== undefined && runtime.version !== undefined) {
    out.push({ field: "version", verdict: compareText(card.version, runtime.version) });
  }
  if (card.protocolVersions !== undefined && runtime.negotiatedVersion !== undefined) {
    // The server negotiated a revision. If the card's declared set does not
    // contain it, the card told a client something untrue about this server.
    const declared = card.protocolVersions.map((v) => v.trim().toLowerCase());
    out.push({
      field: "protocolVersion",
      verdict: declared.includes(runtime.negotiatedVersion.trim().toLowerCase())
        ? "agree"
        : "differ",
    });
  }

  return out;
}

/**
 * Compare the card D1 read against the server D5 spoke to.
 *
 * A pure function over results already in hand. Returns `skip` when either side
 * is missing, which is the common case and is not a finding about the domain.
 */
export function checkCardRuntimeCoherence(results: readonly CheckResult[]): CheckResult {
  const find = (id: CheckId) => results.find((c) => c.id === id);

  const d1 = find("D1");
  const d5 = find("D5");
  if (d1?.status !== "pass") return skip("C1", "no_card_found", 0);
  if (d5?.status !== "pass") return skip("C1", "handshake_did_not_succeed", 0);

  const cardIdentity = (d1.evidence as { cardIdentity?: unknown }).cardIdentity;
  const card = asRecord(cardIdentity) as CardIdentity | undefined;
  if (card === undefined || Object.keys(card).length === 0) {
    return skip("C1", "card_declares_no_identity", 0);
  }

  const evidence5 = d5.evidence as {
    serverInfo?: { name?: string; version?: string };
    negotiatedVersion?: string;
  };
  const runtime: RuntimeIdentity = {
    ...(evidence5.serverInfo?.name === undefined ? {} : { name: evidence5.serverInfo.name }),
    ...(evidence5.serverInfo?.version === undefined
      ? {}
      : { version: evidence5.serverInfo.version }),
    ...(evidence5.negotiatedVersion === undefined
      ? {}
      : { negotiatedVersion: evidence5.negotiatedVersion }),
  };

  const comparisons = compareIdentity(card, runtime);
  if (comparisons.length === 0) return skip("C1", "nothing_comparable", 0);

  // Only fields whose meaning both sides agree on can contradict. See the
  // docblock: `name` is measured, reported, and deliberately not disqualifying.
  const contradictions = comparisons.filter((c) => c.verdict === "differ" && c.field !== "name");
  const nameDiverges = comparisons.some((c) => c.field === "name" && c.verdict === "differ");

  const evidence = {
    comparisons,
    contradictedFields: contradictions.map((c) => c.field),
    nameDiverges,
  };

  return contradictions.length === 0 ? pass("C1", evidence, 0) : fail("C1", evidence, 0);
}
