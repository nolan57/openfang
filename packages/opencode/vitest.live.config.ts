/**
 * Live test configuration for OpenCode.
 *
 * Live tests run against real APIs and services.
 * Requires appropriate environment variables to be set.
 *
 * Run with: OPENCODE_LIVE_TEST=1 bun vitest run --config vitest.live.config.ts
 */

import { defineConfig } from "vitest/config"
import baseConfig from "./vitest.config"

const isLiveTest = process.env.OPENCODE_LIVE_TEST === "1"

if (!isLiveTest) {
  console.log(
    "\n⚠️  Live tests are skipped. Set OPENCODE_LIVE_TEST=1 to run live tests.\n",
  )
}

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: "live",

    // Live tests only
    include: ["src/**/*.live.test.ts", "test/**/*.live.test.ts"],
    exclude: [
      ...(baseConfig.test?.exclude ?? []),
      "src/**/*.test.ts",
      "test/**/*.test.ts",
      "test/**/*.e2e.test.ts",
    ],

    // Single worker to avoid API rate limits
    maxWorkers: 1,

    // Longer timeout for API calls
    testTimeout: 180_000,
    hookTimeout: 240_000,

    // Coverage not typically needed for live tests
    coverage: {
      ...baseConfig.test?.coverage,
      enabled: false,
    },
  },
})
