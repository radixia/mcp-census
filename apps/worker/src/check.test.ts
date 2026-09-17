import { describe, expect, it } from "vitest";
import { runCheck } from "./check.js";
import type { Env } from "./env.js";
import { bundleRunEvidence, runEvidenceBackfill } from "./evidence-backfill.js";

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

describe("evidence backfill", () => {
  const rows = [
    { apex: "a.test", methodologyVersion: "0.4.0", checks: [{ id: "D1" }] },
    { apex: "b.test", methodologyVersion: "0.4.0", checks: [] },
  ];
  const jsonl = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

  async function gzip(text: string): Promise<Uint8Array> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function envWith(bundle: Uint8Array | string) {
    const kv = new Map<string, string>([["evidence-backfill", JSON.stringify({ runs: [6] })]]);
    const puts = new Map<string, string>();
    const env = {
      SCAN_CACHE: {
        get: async (k: string, t?: string) => {
          const v = kv.get(k);
          return v === undefined ? null : t === "json" ? JSON.parse(v) : v;
        },
        put: async (k: string, v: string) => void kv.set(k, v),
        delete: async (k: string) => void kv.delete(k),
      },
      ARTIFACTS: {
        get: async () => ({ body: new Blob([bundle]).stream() }),
        put: async (k: string, v: string) => void puts.set(k, v),
      },
    } as unknown as Env;
    return { env, puts, kv };
  }

  it("reads the bundle whether it arrives compressed or not", async () => {
    // Storing it gzipped and reading it back yields plain JSON through the CLI,
    // so the job sniffs instead of assuming. Both paths have to work or the
    // nightly run throws and nobody sees it until the morning.
    for (const bundle of [await gzip(jsonl), jsonl]) {
      const { env, puts } = envWith(bundle);
      const result = await runEvidenceBackfill(env);
      expect(result?.written).toBe(2);
      expect([...puts.keys()]).toEqual(["evidence/a.test/6.json", "evidence/b.test/6.json"]);
      expect(JSON.parse(puts.get("evidence/a.test/6.json") as string).runId).toBe(6);
    }
  });

  it("does nothing at all when no backfill was asked for", async () => {
    const { env } = envWith(jsonl);
    await env.SCAN_CACHE.delete("evidence-backfill");
    expect(await runEvidenceBackfill(env)).toBeNull();
  });

  it("clears the queue once the last run is expanded", async () => {
    const { env, kv } = envWith(jsonl);
    const result = await runEvidenceBackfill(env);
    expect(result?.done).toBe(true);
    expect(kv.has("evidence-backfill")).toBe(false);
  });
});

describe("run bundling", () => {
  it("gathers a run's per-domain evidence into one gzipped object", async () => {
    const evidence: Record<string, string> = {
      "evidence/a.test/41.json": JSON.stringify({ apex: "a.test", runId: 41, checks: [] }),
      "evidence/b.test/41.json": JSON.stringify({ apex: "b.test", runId: 41, checks: [] }),
    };
    const kv = new Map<string, string>([["evidence-bundle", JSON.stringify({ run: 41 })]]);
    let written: { key: string; body: unknown } | undefined;

    const env = {
      SCAN_CACHE: {
        get: async (k: string, t?: string) => {
          const v = kv.get(k);
          return v === undefined ? null : t === "json" ? JSON.parse(v) : v;
        },
        put: async (k: string, v: string) => void kv.set(k, v),
        delete: async (k: string) => void kv.delete(k),
      },
      ARTIFACTS: {
        get: async (key: string) =>
          evidence[key] === undefined ? null : { text: async () => evidence[key] },
        put: async (key: string, body: unknown) => void (written = { key, body }),
      },
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({ results: [{ apex: "a.test" }, { apex: "b.test" }] }),
          }),
        }),
      },
    } as unknown as Env;

    const result = await bundleRunEvidence(env);
    expect(result).toEqual({ run: 41, rows: 2 });
    expect(written?.key).toBe("evidence/bundles/run-41.jsonl.gz");

    // Round-trip it, because "a stream was passed to put" is not the claim —
    // the claim is that what lands is the gzipped JSONL a release is cut from.
    const bytes = await new Response(written?.body as ReadableStream).arrayBuffer();
    const text = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string).apex).toBe("a.test");

    // And the request is cleared, so it does not rebuild every night.
    expect(kv.has("evidence-bundle")).toBe(false);
  });

  it("does nothing when no bundle was asked for", async () => {
    const env = {
      SCAN_CACHE: { get: async () => null },
    } as unknown as Env;
    expect(await bundleRunEvidence(env)).toBeNull();
  });
});
