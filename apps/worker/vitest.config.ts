import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Plain Node environment, not @cloudflare/vitest-pool-workers.
 *
 * The Worker currently touches nothing but the standard Request/Response types,
 * which Node provides, so the workers pool would be setup cost for no coverage.
 * It arrives in Phase 3 alongside the first real binding (D1, KV, R2, Queues).
 */
export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace package to source so tests never depend on build
      // order, and can never pass against a stale dist.
      "@mcp-census/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
