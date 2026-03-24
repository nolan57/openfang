/**
 * E2E test configuration for OpenCode.
 *
 * Run with: bun vitest run --config vitest.e2e.config.ts
 * Or with custom workers: OPENCODE_E2E_WORKERS=2 bun vitest run --config vitest.e2e.config.ts
 */

import { defineConfig } from "vitest/config"
import os from "node:os"
import baseConfig from "./vitest.config"

const isCI = process.env.CI === "true"
const cpuCount = os.cpus().length
const defaultWorkers = isCI ? Math.min(2, Math.floor(cpuCount * 0.25)) : 1
const requestedWorkers = Number.parseInt(process.env.OPENCODE_E2E_WORKERS ?? "", 10)
const e2eWorkers = Number.isFinite(requestedWorkers) && requestedWorkers > 0
  ? Math.min(16, requestedWorkers)
  : defaultWorkers

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: "e2e",

    // Use vmForks for better isolation
    pool: "vmForks",
    maxWorkers: e2eWorkers,

    // E2E tests only
    include: ["test/**/*.e2e.test.ts"],
    exclude: [
      ...(baseConfig.test?.exclude ?? []),
      "src/**/*.test.ts",
      "src/**/*.live.test.ts",
    ],

    // Longer timeout for E2E tests
    testTimeout: 120_000,
    hookTimeout: 180_000,

    // Quiet output by default (use OPENCODE_E2E_VERBOSE=1 for verbose)
    silent: process.env.OPENCODE_E2E_VERBOSE !== "1",

    // Coverage not typically needed for E2E
    coverage: {
      ...baseConfig.test?.coverage,
      enabled: false,
    },
  },
})
