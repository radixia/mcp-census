/**
 * D5 — unauthenticated handshake. The check that *confirms* a server.
 *
 * Everything before this establishes that a domain published something
 * findable. Only D5 establishes that something answers.
 *
 * There are two protocol eras and they need different probes:
 *
 *  - **modern** (`2026-07-28`+): no handshake at all. `server/discover` is a
 *    plain request that servers **MUST** implement, carrying version, identity
 *    and capabilities in `_meta`.
 *  - **legacy** (`2025-11-25` and earlier): the `initialize` handshake, which
 *    the current revision removed.
 *
 * We try modern first and fall back, which is what the specification tells
 * dual-era clients to do, and the era we end up in is itself a finding — nobody
 * has published the split.
 *
 * Two hard rules, enforced upstream in the guarded client and restated because
 * this is the only check that sends a POST:
 *
 *  - it runs **only** against an endpoint discovery already found, and
 *  - it is **never** authenticated. A `401` is recorded as a fact about the
 *    server, never as a prompt to try harder.
 */

import { headerValue } from "../http/types.js";
import {
  type JsonRpcReply,
  MCP_ERROR,
  parseJsonRpcReply,
  supportedVersionsFrom,
} from "../mcp/jsonrpc.js";
import { MCP_PROTOCOL_VERSIONS } from "../politeness.js";
import type { CheckContext, CheckDeps } from "./deps.js";
import { type CheckResult, fail, pass, skip } from "./types.js";

export type ProtocolEra = "modern" | "legacy";

/** Surfaced in evidence so D6 can echo it back on the same connection. */
function sessionFrom(sessionId: string | undefined): Record<string, unknown> {
  return sessionId === undefined ? {} : { sessionId };
}

interface Attempt {
  readonly era: ProtocolEra;
  readonly method: string;
  readonly protocolVersion?: string;
  readonly httpStatus?: number;
  readonly outcome:
    | "confirmed"
    | "requires_authorization"
    | "modern_error"
    | "no_reply"
    | "skipped_by_robots"
    | "redirected_off_apex"
    | "transport_error";
  readonly jsonRpcErrorCode?: number;
  readonly jsonRpcErrorMessage?: string;
}

function serverInfoOf(reply: JsonRpcReply): { name?: string; version?: string } | undefined {
  const meta = reply.result?._meta;
  const modern =
    typeof meta === "object" && meta !== null
      ? (meta as Record<string, unknown>)["io.modelcontextprotocol/serverInfo"]
      : undefined;
  // Legacy `initialize` returns serverInfo at the top level of the result.
  const info = modern ?? reply.result?.serverInfo;
  if (typeof info !== "object" || info === null) return undefined;

  const record = info as { name?: unknown; version?: unknown };
  return {
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.version === "string" ? { version: record.version } : {}),
  };
}

function capabilityNames(reply: JsonRpcReply): string[] {
  const capabilities = reply.result?.capabilities;
  if (typeof capabilities !== "object" || capabilities === null) return [];
  return Object.keys(capabilities);
}

export async function checkHandshake(
  deps: CheckDeps,
  _context: CheckContext,
): Promise<CheckResult> {
  const started = deps.now();
  const url = deps.client.endpointUrl;

  if (url === undefined) {
    return skip("D5", "no_endpoint_discovered", deps.now() - started);
  }

  const attempts: Attempt[] = [];

  /** One POST, classified. Returns the reply when the server actually answered. */
  const attempt = async (
    era: ProtocolEra,
    method: string,
    protocolVersion?: string,
  ): Promise<{ reply?: JsonRpcReply; sessionId?: string; attempt: Attempt }> => {
    const outcome = await deps.client.postJsonRpc({
      url,
      method,
      ...(protocolVersion === undefined ? {} : { protocolVersion }),
    });

    const base = {
      era,
      method,
      ...(protocolVersion === undefined ? {} : { protocolVersion }),
    } as const;

    if (outcome.outcome === "skipped_by_robots") {
      return { attempt: { ...base, outcome: "skipped_by_robots" } };
    }
    if (outcome.outcome === "redirect_off_apex") {
      return { attempt: { ...base, outcome: "redirected_off_apex" } };
    }
    if (outcome.outcome === "transport_error") {
      return { attempt: { ...base, outcome: "transport_error" } };
    }

    const { response } = outcome;
    const reply = parseJsonRpcReply(response);

    // Authorization required. This is the observation that resolves D4's
    // ambiguity: a server demanding a token MUST advertise its authorization
    // servers, so a D4 failure here really is non-compliance rather than
    // "this server needs no auth".
    if (response.status === 401) {
      return {
        attempt: { ...base, outcome: "requires_authorization", httpStatus: 401 },
      };
    }

    if (reply?.result !== undefined) {
      // Legacy servers mint a session on initialize and reject later requests
      // without it. Capturing it here is what lets D6 reach tools/list on them.
      const sessionId = headerValue(response, "mcp-session-id");
      return {
        reply,
        ...(sessionId === undefined ? {} : { sessionId }),
        attempt: { ...base, outcome: "confirmed", httpStatus: response.status },
      };
    }

    if (reply?.error !== undefined) {
      return {
        reply,
        attempt: {
          ...base,
          outcome: "modern_error",
          httpStatus: response.status,
          jsonRpcErrorCode: reply.error.code,
          ...(reply.error.message === undefined
            ? {}
            : { jsonRpcErrorMessage: reply.error.message }),
        },
      };
    }

    return { attempt: { ...base, outcome: "no_reply", httpStatus: response.status } };
  };

  const finish = (
    era: ProtocolEra,
    reply: JsonRpcReply,
    extra: Record<string, unknown> = {},
  ): CheckResult => {
    const info = serverInfoOf(reply);
    const supportedVersions = reply.result?.supportedVersions;

    return pass(
      "D5",
      {
        endpointUrl: url,
        era,
        attempts,
        capabilities: capabilityNames(reply),
        ...(Array.isArray(supportedVersions) ? { supportedVersions } : {}),
        // Self-reported and unverified by the protocol; recorded for display,
        // never used to decide anything.
        ...(info === undefined ? {} : { serverInfo: info }),
        ...extra,
      },
      deps.now() - started,
    );
  };

  // --- modern -------------------------------------------------------------
  const modern = await attempt("modern", "server/discover", MCP_PROTOCOL_VERSIONS.modern);
  attempts.push(modern.attempt);

  if (modern.attempt.outcome === "confirmed" && modern.reply !== undefined) {
    return finish("modern", modern.reply, sessionFrom(modern.sessionId));
  }

  if (modern.attempt.outcome === "requires_authorization") {
    // A confirmed MCP server that we are not permitted to talk to. That is a
    // real detection, not a failure — and it makes D4 mandatory for this domain.
    return pass(
      "D5",
      { endpointUrl: url, era: "modern", attempts, requiresAuthorization: true },
      deps.now() - started,
    );
  }

  // The server told us which versions it speaks. Retry with one of them: it is
  // unambiguously a modern MCP server, we simply asked in the wrong dialect.
  if (modern.attempt.jsonRpcErrorCode === MCP_ERROR.unsupportedProtocolVersion) {
    const [version] = supportedVersionsFrom(modern.reply?.error);
    if (version !== undefined) {
      const retry = await attempt("modern", "server/discover", version);
      attempts.push(retry.attempt);
      if (retry.attempt.outcome === "confirmed" && retry.reply !== undefined) {
        return finish("modern", retry.reply, {
          negotiatedVersion: version,
          ...sessionFrom(retry.sessionId),
        });
      }
    }
  }

  // --- legacy -------------------------------------------------------------
  // Only worth trying if the server did not answer with a recognised modern
  // error: those identify a modern server, and falling back would misreport it.
  const recognisedModern =
    modern.attempt.jsonRpcErrorCode === MCP_ERROR.unsupportedProtocolVersion ||
    modern.attempt.jsonRpcErrorCode === MCP_ERROR.headerMismatch;

  if (!recognisedModern) {
    const legacy = await attempt("legacy", "initialize");
    attempts.push(legacy.attempt);

    if (legacy.attempt.outcome === "confirmed" && legacy.reply !== undefined) {
      const version = legacy.reply.result?.protocolVersion;
      return finish("legacy", legacy.reply, {
        ...(typeof version === "string" ? { negotiatedVersion: version } : {}),
        ...sessionFrom(legacy.sessionId),
      });
    }
    if (legacy.attempt.outcome === "requires_authorization") {
      return pass(
        "D5",
        { endpointUrl: url, era: "legacy", attempts, requiresAuthorization: true },
        deps.now() - started,
      );
    }
  }

  return fail("D5", { endpointUrl: url, attempts }, deps.now() - started);
}
