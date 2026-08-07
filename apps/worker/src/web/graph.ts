/**
 * The discovery graph: the chain of evidence, and where it stopped.
 *
 * A table can say `D7 pass`. It cannot say that we saw a catalog advertised and
 * deliberately did not open it, that `C1` compares two nodes at opposite ends of
 * the chain rather than extending it, or that "we found nothing" and "we were
 * refused" are different facts. Those three distinctions are most of what the
 * project measured in methodology 0.4.0, and none of them survives a status
 * column.
 *
 * It is also the thing `experimental-ext-server-card#40` is asking for. That
 * blocker wants best practices for showing a user the chain from the domain that
 * publishes a card to the domain that owns the server. This is that chain, drawn.
 *
 * ## Parallel, not a pipeline
 *
 * The tempting picture is `domain → catalog → card → endpoint`, and it is wrong.
 * A card may live at any unreserved URI, the AI Catalog well-known path is
 * optional, and DNS and the conventional endpoint reach a server without any
 * document at all. So discovery is drawn as **parallel routes that converge**,
 * and a route we did not take is labelled as such rather than omitted. Leaving it
 * out would let absence of a node read as absence of a mechanism.
 *
 * ## HTML, not a drawn SVG
 *
 * The topology is fixed — stages, with several routes inside one of them — so
 * there is no layout to compute. Rendering it as real elements keeps the text
 * selectable, keeps it available to a screen reader in reading order, and lets it
 * reflow on a phone. A generated SVG would look more like a graph and be worse at
 * every one of those.
 */

import { esc } from "./layout.js";

/**
 * What we know about a node, in the order a reader needs it: what we did, what
 * came back, and what that does or does not license them to conclude.
 */
export type NodeState =
  | "observed"
  /** Seen, and deliberately not followed. `D7`'s whole point. */
  | "observed_not_followed"
  /** We looked and it was not there. */
  | "absent"
  /** We were refused or the server broke. Says nothing about the domain. */
  | "blocked"
  /** Its precondition never happened. */
  | "not_attempted"
  /** The run predates this check, so there is no row at all. */
  | "not_in_run"
  /** This profile never runs it. The quick check cannot do everything. */
  | "not_in_profile"
  /** This profile does not measure it at all. */
  | "outside_profile"
  /** C1 only: the two sides agree, or they do not. Neither is a discovery. */
  | "agrees"
  | "contradicts";

const STATE_WORDS: Record<NodeState, string> = {
  observed: "observed",
  observed_not_followed: "observed, not followed",
  absent: "not observed",
  blocked: "inconclusive",
  not_attempted: "not reached",
  not_in_run: "not in this run",
  not_in_profile: "not run here",
  outside_profile: "outside this profile",
  agrees: "agrees",
  contradicts: "contradicts",
};

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly state: NodeState;
  /** What we asked, in the words of the request itself. */
  readonly method: string;
  /** What a reader may take from it. Never a verdict on the organisation. */
  readonly reading: string;
}

interface CheckRow {
  readonly check_id: string;
  readonly status: string;
  readonly detail: string | null;
}

/** Map a stored check row onto a node state. */
/**
 * Which probe produced these rows.
 *
 * The on-demand check at `/census/check` runs four of the nine checks: it has no
 * DNS resolver at the edge, and it does not open a connection to a stranger's
 * server on a request any visitor can make. Rendering those six as "not reached"
 * told a reader we had tried, and rendering them as "not in this run" implied the
 * measurement was merely old. Both were wrong in the same direction, and both
 * made a four-check answer look like a nine-check one.
 */
export type GraphProfile = "census" | "on_demand";

/** What the quick check cannot do, and the honest reason. */
const NOT_IN_QUICK_CHECK: Record<string, string> = {
  D2: "A DNS lookup is not available where this check runs.",
  D3: "The full census probes these; the quick check reads documents only.",
  D5: "We do not open a connection to someone else's server on a request a stranger can make.",
  D6: "Needs a connection, which this check does not open.",
  C1: "Needs both a card and a handshake.",
};

export function stateOf(row: CheckRow | undefined): NodeState {
  // A missing row and a skip are different facts. A skip means we got there and
  // the evidence was not available; a missing row means this run did not run the
  // check at all, usually because it predates it. Showing the second as "not
  // reached" tells a reader we tried and failed, which is not true.
  if (row === undefined) return "not_in_run";
  // C1 is a comparison, not a discovery. "observed" and "not observed" are the
  // wrong words for it: nothing is being looked for, two things are being held
  // against each other.
  if (row.check_id === "C1") {
    if (row.status === "pass") return "agrees";
    if (row.status === "fail") return "contradicts";
  }
  if (row.status === "pass") return row.check_id === "D7" ? "observed_not_followed" : "observed";
  if (row.status === "skip") return "not_attempted";
  if (row.status === "error") return "blocked";
  // fail: the taxonomy says whether we learned anything.
  if (row.detail === "inconclusive_blocked") return "blocked";
  return "absent";
}

/** Method line per check, so a reader can repeat what we did. */
const METHODS: Record<string, string> = {
  D1: "GET each published candidate path",
  D2: "TXT lookup at _mcp.<domain>",
  D3: "HEAD the conventional endpoint locations",
  D4: "GET /.well-known/oauth-protected-resource",
  D5: "One unauthenticated JSON-RPC call to the endpoint",
  D6: "tools/list on the same connection",
  D7: "GET /, then read the Link header and the head",
  C1: "Compare the card's claims against the handshake",
};

function readingFor(
  id: string,
  state: NodeState,
  detail: string | null,
  headerOnly = false,
): string {
  if (id === "D7" && headerOnly) {
    return state === "observed_not_followed"
      ? "A catalog is advertised in the response header. We recorded that it exists and did not fetch it."
      : "Nothing in the response header. This quick check reads the header only, so an advertisement in the page itself would not be seen here.";
  }
  if (id === "D7" && state === "observed_not_followed") {
    return "A catalog is advertised here. We recorded that it exists and did not fetch it: following an address a publisher chooses is not something an unattended crawler should do.";
  }
  if (id === "C1") {
    if (state === "contradicts") {
      return "The card states something the server does not. A client reads the card before it can check any of it, which is why the extension made this a MUST.";
    }
    if (state === "agrees") return "Every field present on both sides matches.";
  }
  if (id === "D4" && state === "absent") {
    return "No authorization metadata. Authorization is optional in MCP, so this says nothing about conformance.";
  }
  if (state === "blocked") {
    return detail === "inconclusive_blocked"
      ? "A candidate refused us. Absence is not established."
      : "We could not complete this. It is a fact about our crawl, not about the domain.";
  }
  if (state === "absent")
    return "Nothing at the paths this profile publishes. Not proof of absence.";
  if (state === "not_attempted") return "The evidence this needs was never collected.";
  if (state === "not_in_run") {
    return "This measurement predates the check. It will appear on the next full run.";
  }
  return "";
}

export function buildGraph(
  rows: readonly CheckRow[],
  profile: GraphProfile = "census",
): {
  discovery: GraphNode[];
  chain: GraphNode[];
  crossCheck: GraphNode | undefined;
} {
  const by = new Map(rows.map((r) => [r.check_id, r]));
  const node = (id: string, label: string): GraphNode => {
    const row = by.get(id);
    const outOfProfile =
      row === undefined && profile === "on_demand" && NOT_IN_QUICK_CHECK[id] !== undefined;
    const state: NodeState = outOfProfile ? "not_in_profile" : stateOf(row);
    return {
      id,
      label,
      state,
      method: METHODS[id] ?? "",
      reading: outOfProfile
        ? (NOT_IN_QUICK_CHECK[id] ?? "")
        : // The quick check runs D7 with HEAD, so it cannot see an HTML <link>.
          // The row alone does not say that; the profile does.
          readingFor(id, state, row?.detail ?? null, id === "D7" && profile === "on_demand"),
    };
  };

  return {
    discovery: [
      node("D1", "Server card"),
      node("D2", "DNS record"),
      node("D3", "Conventional endpoint"),
      node("D4", "Authorization metadata"),
      node("D7", "Advertised by the home page"),
    ],
    chain: [node("D5", "A server answered"), node("D6", "It listed its tools")],
    crossCheck:
      by.has("C1") || profile === "on_demand"
        ? node("C1", "The card matches the server")
        : undefined,
  };
}

/**
 * Mechanisms this profile does not measure.
 *
 * Shown, not omitted. A graph that silently leaves these out invites a reader to
 * conclude the domain has no catalog, when what happened is that we start from a
 * bare domain and never had a page URL to look at.
 */
const OUTSIDE = [
  "Link relations on any page other than the home page",
  "Fetching an advertised catalog to see what is in it",
  "Anything behind authentication, or in a marketplace",
];

function nodeHtml(n: GraphNode): string {
  return `<li class="gnode" data-state="${esc(n.state)}">
<p class="gstate">${esc(STATE_WORDS[n.state])}</p>
<p class="glabel">${esc(n.label)} <span class="mono note">${esc(n.id)}</span></p>
${n.method === "" ? "" : `<p class="gmethod mono">${esc(n.method)}</p>`}
${n.reading === "" ? "" : `<p class="note">${esc(n.reading)}</p>`}
</li>`;
}

export function discoveryGraph(
  rows: readonly CheckRow[],
  profile: GraphProfile = "census",
): string {
  const g = buildGraph(rows, profile);
  const reached = g.chain[0]?.state === "observed";

  return `<figure class="graph">
<figcaption>How far an agent gets, and where it stops. Routes run in parallel: no
document is required to reach a server, and no server is required to publish one.${
    profile === "on_demand"
      ? " This quick check runs five of the nine, and reads the home page header without downloading the page; the census runs all of them."
      : ""
  }</figcaption>

<p class="gstage">Starting from the bare domain</p>
<ul class="grow">${g.discovery.map(nodeHtml).join("")}</ul>

<p class="gstage">${reached ? "Converging on a server" : "Nothing converged on a server"}</p>
<ul class="grow">${g.chain.map(nodeHtml).join("")}</ul>

${
  g.crossCheck === undefined
    ? ""
    : `<p class="gstage">Holding the two ends against each other</p>
<ul class="grow">${nodeHtml(g.crossCheck)}</ul>`
}

<p class="gstage">Not measured here</p>
<ul class="grow">${OUTSIDE.map(
    (label) =>
      `<li class="gnode" data-state="outside_profile"><p class="gstate">${esc(
        STATE_WORDS.outside_profile,
      )}</p><p class="glabel">${esc(label)}</p></li>`,
  ).join("")}</ul>
</figure>`;
}
