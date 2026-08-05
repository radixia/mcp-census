/**
 * Reading a JSON-RPC reply out of an MCP HTTP response.
 *
 * The transport permits the server to answer a request with either a single
 * JSON object or an SSE stream, and the client "MUST support both". A prober
 * that only parses JSON silently misreads every streaming server as broken.
 */

import type { HttpResponse } from "../http/types.js";
import { headerValue } from "../http/types.js";

export interface JsonRpcError {
  readonly code: number;
  readonly message?: string;
  readonly data?: unknown;
}

export interface JsonRpcReply {
  readonly result?: Record<string, unknown>;
  readonly error?: JsonRpcError;
}

/** Error codes the specification defines, which only a modern server emits. */
export const MCP_ERROR = {
  unsupportedProtocolVersion: -32022,
  headerMismatch: -32020,
  methodNotFound: -32601,
} as const;

function asReply(value: unknown): JsonRpcReply | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== "2.0") return undefined;

  const result = record.result;
  const error = record.error;

  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") {
      return { error: error as unknown as JsonRpcError };
    }
  }

  if (typeof result === "object" && result !== null) {
    return { result: result as Record<string, unknown> };
  }

  return undefined;
}

/**
 * Parse a reply from either shape.
 *
 * For SSE, the final response terminates the stream, so the last `data:` frame
 * that parses as a JSON-RPC reply is the answer; earlier frames are progress
 * notifications and are ignored.
 */
export function parseJsonRpcReply(response: HttpResponse): JsonRpcReply | undefined {
  const contentType = (headerValue(response, "content-type") ?? "").toLowerCase();

  if (contentType.includes("text/event-stream")) {
    let last: JsonRpcReply | undefined;
    for (const line of response.body.split(/\r\n|\r|\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "") continue;
      try {
        const reply = asReply(JSON.parse(payload));
        if (reply !== undefined) last = reply;
      } catch {
        // A partial frame. Keep reading; the stream may still deliver a reply.
      }
    }
    return last;
  }

  try {
    return asReply(JSON.parse(response.body));
  } catch {
    return undefined;
  }
}

/** Versions a server named in an UnsupportedProtocolVersionError. */
export function supportedVersionsFrom(error: JsonRpcError | undefined): string[] {
  if (error?.code !== MCP_ERROR.unsupportedProtocolVersion) return [];
  const data = error.data;
  if (typeof data !== "object" || data === null) return [];
  const supported = (data as { supported?: unknown }).supported;
  return Array.isArray(supported)
    ? supported.filter((v): v is string => typeof v === "string")
    : [];
}
