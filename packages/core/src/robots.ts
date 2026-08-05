/**
 * robots.txt parsing and matching, following RFC 9309.
 *
 * This is the gate every other request passes through, so it errs toward being
 * excluded: ambiguous agent matching resolves in the site owner's favour, and a
 * `Crawl-delay` is honoured whenever it is stricter than our own rate limit.
 *
 * We apply it to `.well-known` paths too, which arguably we would not have to.
 * Doing so costs us coverage; `skipped_by_robots` is reported as its own public
 * category rather than folded into failures, so that cost is visible.
 */

/** RFC 9309 §2.5: crawlers must parse at least 500 KiB and may stop there. */
export const MAX_ROBOTS_BYTES = 500 * 1024;

export interface RobotsRule {
  readonly type: "allow" | "disallow";
  readonly pattern: string;
}

export interface RobotsGroup {
  /** Lower-cased product tokens this group applies to. */
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
  readonly crawlDelaySeconds?: number;
}

export interface RobotsTxt {
  readonly groups: readonly RobotsGroup[];
  readonly sitemaps: readonly string[];
  /** True when the file existed but contained no usable directives. */
  readonly empty: boolean;
}

export const EMPTY_ROBOTS: RobotsTxt = { groups: [], sitemaps: [], empty: true };

interface MutableGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds?: number;
}

/**
 * Parse robots.txt. Never throws: a malformed file is a fact about the domain,
 * not an error in our crawl, and unparseable directives are skipped
 * individually rather than discarding the whole file.
 */
export function parseRobotsTxt(text: string): RobotsTxt {
  const truncated = text.length > MAX_ROBOTS_BYTES ? text.slice(0, MAX_ROBOTS_BYTES) : text;
  const groups: MutableGroup[] = [];
  const sitemaps: string[] = [];

  let current: MutableGroup | undefined;
  // Consecutive user-agent lines share one group; the first rule line after them
  // closes the agent list, so a later user-agent line starts a new group.
  let acceptingAgents = false;

  for (const rawLine of truncated.split(/\r\n|\r|\n/)) {
    const line = stripComment(rawLine).trim();
    if (line === "") continue;

    const separator = line.indexOf(":");
    if (separator <= 0) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case "user-agent": {
        if (value === "") break;
        if (!acceptingAgents || current === undefined) {
          current = { agents: [], rules: [] };
          groups.push(current);
          acceptingAgents = true;
        }
        current.agents.push(value.toLowerCase());
        break;
      }
      case "allow":
      case "disallow": {
        if (current === undefined) break;
        acceptingAgents = false;
        // RFC 9309 §2.2.2: an empty Disallow imposes no restriction. Keeping it
        // as a zero-length prefix would match every path and block the site.
        if (value === "") break;
        current.rules.push({ type: field, pattern: value });
        break;
      }
      case "crawl-delay": {
        if (current === undefined) break;
        acceptingAgents = false;
        const seconds = Number.parseFloat(value);
        if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelaySeconds = seconds;
        break;
      }
      case "sitemap": {
        if (value !== "") sitemaps.push(value);
        break;
      }
      default:
        break;
    }
  }

  return {
    groups: groups.map((g) => ({
      agents: g.agents,
      rules: g.rules,
      ...(g.crawlDelaySeconds === undefined ? {} : { crawlDelaySeconds: g.crawlDelaySeconds }),
    })),
    sitemaps,
    empty: groups.length === 0 && sitemaps.length === 0,
  };
}

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return hash === -1 ? line : line.slice(0, hash);
}

/**
 * Does a robots.txt user-agent value apply to our product token?
 *
 * Exact match, or the robots value is a prefix of our token — the behaviour
 * major crawlers implement, and the conservative choice: it can only ever put us
 * *into* a more restrictive group, never out of one.
 */
function agentMatches(robotsAgent: string, token: string): boolean {
  const a = robotsAgent.toLowerCase();
  const t = token.toLowerCase();
  return a === t || t.startsWith(a);
}

/**
 * The group governing us: the most specific named match, else the `*` group.
 * Groups naming the same token are merged, since a file may repeat a token.
 */
export function groupFor(robots: RobotsTxt, token: string): RobotsGroup | undefined {
  let best: RobotsGroup | undefined;
  let bestSpecificity = -1;

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === "*") continue;
      if (!agentMatches(agent, token)) continue;
      if (agent.length > bestSpecificity) {
        best = group;
        bestSpecificity = agent.length;
      }
    }
  }

  if (best !== undefined) return mergeMatching(robots, token, false);
  const wildcard = robots.groups.some((g) => g.agents.includes("*"));
  return wildcard ? mergeMatching(robots, token, true) : undefined;
}

function mergeMatching(robots: RobotsTxt, token: string, wildcard: boolean): RobotsGroup {
  const rules: RobotsRule[] = [];
  const agents: string[] = [];
  let crawlDelaySeconds: number | undefined;

  for (const group of robots.groups) {
    const applies = wildcard
      ? group.agents.includes("*")
      : group.agents.some((a) => a !== "*" && agentMatches(a, token));
    if (!applies) continue;

    agents.push(...group.agents);
    rules.push(...group.rules);
    if (group.crawlDelaySeconds !== undefined) {
      crawlDelaySeconds =
        crawlDelaySeconds === undefined
          ? group.crawlDelaySeconds
          : Math.max(crawlDelaySeconds, group.crawlDelaySeconds);
    }
  }

  return {
    agents,
    rules,
    ...(crawlDelaySeconds === undefined ? {} : { crawlDelaySeconds }),
  };
}

/** `*` matches any sequence; a trailing `$` anchors the end. */
function patternToRegExp(pattern: string): RegExp {
  let body = pattern;
  let anchorEnd = false;

  if (body.endsWith("$")) {
    anchorEnd = true;
    body = body.slice(0, -1);
  }

  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}${anchorEnd ? "$" : ""}`);
}

/**
 * RFC 9309 §2.2.2: the longest matching pattern wins, and Allow wins a tie.
 * A path matched by no rule is allowed.
 */
export function isAllowed(robots: RobotsTxt, token: string, path: string): boolean {
  const group = groupFor(robots, token);
  if (group === undefined || group.rules.length === 0) return true;

  let verdict = true;
  let bestLength = -1;

  for (const rule of group.rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;

    const length = rule.pattern.length;
    if (length > bestLength) {
      bestLength = length;
      verdict = rule.type === "allow";
    } else if (length === bestLength && rule.type === "allow") {
      verdict = true;
    }
  }

  return verdict;
}

/** Crawl-delay in ms, when the site asks for something slower than our own limit. */
export function crawlDelayMs(robots: RobotsTxt, token: string): number | undefined {
  const seconds = groupFor(robots, token)?.crawlDelaySeconds;
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

/** What a domain has said about one specific agent. Reported by F2. */
export type AgentPosture =
  /** Named, and allowed everywhere. */
  | "explicitly_allowed"
  /** Named, and shut out entirely. */
  | "explicitly_disallowed"
  /** Named, allowed at the root, but restricted somewhere. */
  | "partially_restricted"
  /** Not named at all; only the `*` group, or nothing, applies. */
  | "not_mentioned";

export function agentPosture(robots: RobotsTxt, token: string): AgentPosture {
  const named = robots.groups.some((g) =>
    g.agents.some((a) => a !== "*" && agentMatches(a, token)),
  );
  if (!named) return "not_mentioned";

  if (!isAllowed(robots, token, "/")) return "explicitly_disallowed";

  const group = groupFor(robots, token);
  const restricted = group?.rules.some((r) => r.type === "disallow") ?? false;
  return restricted ? "partially_restricted" : "explicitly_allowed";
}
