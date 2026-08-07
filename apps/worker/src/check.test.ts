import { describe, expect, it } from "vitest";
import { runCheck } from "./check.js";
import type { Env } from "./env.js";

/**
 * The on-demand check is the one thing on this site a stranger can make us do to
 * a third party, so its caching is a politeness control rather than a
 * performance one. These tests hold the two rules that keep it bounded: a target
 * is probed at most once per window, and a probe that *fails* is remembered too.
 */

interface Put {
  key: string;
  ttl: number | undefined;
}

/**
 * `optouts` is the first table `quickProbe` touches, so failing it is the
 * shortest honest way to make the probe throw — the same shape as any
 * mid-probe failure.
 */
function fakeEnv(options: { failOptOuts?: boolean } = {}): {
  env: Env;
  kv: Map<string, string>;
  puts: Put[];
  inserts: string[];
} {
  const kv = new Map<string, string>();
  const puts: Put[] = [];
  const inserts: string[] = [];

  const env = {
    SCAN_CACHE: {
      get: async (key: string, type?: string) => {
        const raw = kv.get(key);
        if (raw === undefined) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      },
      put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        // The real KV refuses anything under 60 seconds. A fake that accepts it
        // is a fake that green-lights a deploy the platform will reject: a
        // 30-second lock shipped past 145 passing tests and returned 1101 on
        // every uncached check for an hour.
        const ttl = opts?.expirationTtl;
        if (ttl !== undefined && ttl < 60) {
          throw new Error(`KV rejects expirationTtl ${ttl}; the minimum is 60`);
        }
        kv.set(key, value);
        puts.push({ key, ttl });
      },
    },
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => null,
          all: async () => {
            if (options.failOptOuts && sql.includes("optouts")) throw new Error("D1 unavailable");
            return { results: [] };
          },
          run: async () => {
            inserts.push(String(args[0]));
            return {};
          },
        }),
        all: async () => {
          if (options.failOptOuts && sql.includes("optouts")) throw new Error("D1 unavailable");
          return { results: [] };
        },
      }),
    },
  } as unknown as Env;

  return { env, kv, puts, inserts };
}

describe("on-demand check, as a politeness control", () => {
  it("remembers a failed probe, so a struggling target is not re-probed on every request", async () => {
    // The gap this closes: a throw skipped the cache write, so a domain that
    // reliably made us fail could be probed without limit — and hardest exactly
    // when it was already in trouble.
    const { env, puts } = fakeEnv({ failOptOuts: true });

    const outcome = await runCheck(env, "example.com");

    expect(outcome.assessed).toBe(false);
    expect(outcome.unassessedReason).toBe("unreachable");

    const cached = puts.find((p) => p.key.startsWith("check:"));
    expect(cached).toBeDefined();
    // Short: long enough to stop the loop, short enough that a passing outage
    // is not published as this domain's answer for an hour.
    expect(cached?.ttl).toBe(300);
  });

  it("does not record a domain it never managed to measure", async () => {
    const { env, inserts } = fakeEnv({ failOptOuts: true });
    await runCheck(env, "example.com");
    expect(inserts).toEqual([]);
  });

  it("serves the cache instead of probing again", async () => {
    const { env, kv, puts } = fakeEnv({ failOptOuts: true });
    await runCheck(env, "example.com");
    const key = [...kv.keys()].find((k) => k.startsWith("check:"));
    expect(key).toBeDefined();

    const before = puts.length;
    const second = await runCheck(env, "example.com");
    expect(second.apex).toBe("example.com");
    // Nothing new written: the second request never reached the probe.
    expect(puts.length).toBe(before);
  });

  it("turns a stampede on one uncached domain into a trickle", async () => {
    const { env, kv } = fakeEnv({ failOptOuts: true });
    kv.set("checking:example.com", "1");

    const outcome = await runCheck(env, "example.com");

    expect(outcome.assessed).toBe(false);
    expect(outcome.fixes[0]?.title).toContain("already running");
  });

  it("keys the cache by methodology version, so a bump cannot serve stale checks", async () => {
    const { env, kv } = fakeEnv({ failOptOuts: true });
    await runCheck(env, "example.com");
    const key = [...kv.keys()].find((k) => k.startsWith("check:"));
    expect(key).toMatch(/^check:\d+\.\d+\.\d+:example\.com$/);
  });
});
