/**
 * D6 — tool listing, and Q1 — the shape of that tool surface.
 *
 * `tools/list` is read-only: it returns the descriptions a server chose to
 * publish. It runs only after D5 confirmed a server, and `tools/call` remains
 * absent from the method allowlist, so there is no path from here to invoking
 * anything.
 *
 * Q1 measures whether the surface is *usable by an agent*, which is a different
 * question from whether it exists. A tool with no description is a tool a model
 * cannot choose correctly, and a parameter with no description is one it cannot
 * fill. Both are the difference between a server that technically responds and
 * one an agent can actually drive.
 */

import { parseJsonRpcReply } from "../mcp/jsonrpc.js";
import type { CheckContext, CheckDeps } from "./deps.js";
import { type CheckResult, errored, fail, pass, skip } from "./types.js";

interface ToolShape {
  readonly name: string;
  readonly describedChars: number;
  readonly parameters: number;
  readonly parametersDescribed: number;
}

/** Descriptions shorter than this cannot meaningfully disambiguate a tool. */
const MIN_USEFUL_DESCRIPTION = 20;

function shapeOf(tool: unknown): ToolShape | undefined {
  if (typeof tool !== "object" || tool === null) return undefined;
  const record = tool as { name?: unknown; description?: unknown; inputSchema?: unknown };
  if (typeof record.name !== "string") return undefined;

  const description = typeof record.description === "string" ? record.description.trim() : "";

  let parameters = 0;
  let parametersDescribed = 0;
  const schema = record.inputSchema;
  if (typeof schema === "object" && schema !== null) {
    const properties = (schema as { properties?: unknown }).properties;
    if (typeof properties === "object" && properties !== null) {
      for (const value of Object.values(properties as Record<string, unknown>)) {
        parameters++;
        if (
          typeof value === "object" &&
          value !== null &&
          typeof (value as { description?: unknown }).description === "string" &&
          (value as { description: string }).description.trim() !== ""
        ) {
          parametersDescribed++;
        }
      }
    }
  }

  return { name: record.name, describedChars: description.length, parameters, parametersDescribed };
}

export interface ToolSurface {
  readonly toolCount: number;
  readonly described: number;
  readonly usefullyDescribed: number;
  readonly medianDescriptionChars: number;
  readonly parameters: number;
  readonly parametersDescribed: number;
  readonly parameterCoverage: number;
}

export function summariseToolSurface(tools: readonly ToolShape[]): ToolSurface {
  const lengths = tools.map((t) => t.describedChars).sort((a, b) => a - b);
  const mid = Math.floor(lengths.length / 2);
  const median =
    lengths.length === 0
      ? 0
      : lengths.length % 2 === 1
        ? (lengths[mid] ?? 0)
        : Math.round(((lengths[mid - 1] ?? 0) + (lengths[mid] ?? 0)) / 2);

  const parameters = tools.reduce((n, t) => n + t.parameters, 0);
  const parametersDescribed = tools.reduce((n, t) => n + t.parametersDescribed, 0);

  return {
    toolCount: tools.length,
    described: tools.filter((t) => t.describedChars > 0).length,
    usefullyDescribed: tools.filter((t) => t.describedChars >= MIN_USEFUL_DESCRIPTION).length,
    medianDescriptionChars: median,
    parameters,
    parametersDescribed,
    parameterCoverage: parameters === 0 ? 1 : parametersDescribed / parameters,
  };
}

export async function checkToolListing(
  deps: CheckDeps,
  _context: CheckContext,
  /** Session id minted during D5, if the server issued one. */
  sessionId?: string,
): Promise<{ d6: CheckResult; q1: CheckResult }> {
  const started = deps.now();
  const url = deps.client.endpointUrl;

  if (url === undefined) {
    const reason = skip("D6", "no_endpoint_discovered", 0);
    return { d6: reason, q1: skip("Q1", "no_endpoint_discovered", 0) };
  }

  const outcome = await deps.client.postJsonRpc({
    url,
    method: "tools/list",
    ...(sessionId === undefined ? {} : { sessionId }),
  });
  const latencyMs = deps.now() - started;

  if (outcome.outcome !== "response") {
    const evidence = { endpointUrl: url, outcome: outcome.outcome };
    return {
      d6: fail("D6", evidence, latencyMs),
      q1: skip("Q1", "handshake_did_not_succeed", 0),
    };
  }

  const reply = parseJsonRpcReply(outcome.response);

  if (reply?.result === undefined) {
    const evidence = {
      endpointUrl: url,
      httpStatus: outcome.response.status,
      ...(reply?.error === undefined ? {} : { jsonRpcErrorCode: reply.error.code }),
    };
    return {
      d6: fail("D6", evidence, latencyMs),
      q1: skip("Q1", "handshake_did_not_succeed", 0),
    };
  }

  const raw = reply.result.tools;
  if (!Array.isArray(raw)) {
    return {
      d6: errored("D6", "tools/list result has no tools array", latencyMs),
      q1: skip("Q1", "handshake_did_not_succeed", 0),
    };
  }

  const tools = raw.map(shapeOf).filter((t): t is ToolShape => t !== undefined);
  const surface = summariseToolSurface(tools);

  return {
    d6: pass(
      "D6",
      {
        endpointUrl: url,
        toolCount: surface.toolCount,
        // Names only. We never record what a tool does with its arguments,
        // because we never call one.
        toolNames: tools.map((t) => t.name).slice(0, 60),
      },
      latencyMs,
    ),
    // Q1 passes when an agent could actually choose and fill these tools:
    // every tool usefully described, and most parameters documented.
    q1:
      surface.toolCount > 0 &&
      surface.usefullyDescribed === surface.toolCount &&
      surface.parameterCoverage >= 0.8
        ? pass("Q1", surface as unknown as Record<string, unknown>, 0)
        : fail("Q1", surface as unknown as Record<string, unknown>, 0),
  };
}
