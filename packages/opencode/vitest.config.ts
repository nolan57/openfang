/**
 * Base Vitest configuration for OpenCode.
 * Shared settings used by all test configurations.
 */

import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(repoRoot, "src"),
      "@opencode-ai/plugin": path.join(repoRoot, "..", "plugin", "src"),
      "@opencode-ai/util": path.join(repoRoot, "..", "util", "src"),
    },
  },
  test: {
    // Global test settings
    testTimeout: 30_000,
    hookTimeout: 60_000,

    // Prevent test pollution
    unstubEnvs: true,
    unstubGlobals: true,

    // Use forks for isolation
    pool: "forks",

    // Worker count (adjusted per config)
    maxWorkers: process.env.CI ? 2 : 4,

    // Include test files
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],

    // Exclude patterns (overridden by specific configs)
    exclude: [
      "node_modules/**",
      "dist/**",
      "migration/**",
      "**/*.spec.ts",
    ],

    // Coverage settings
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      all: false, // Only count tested files
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
      include: ["./src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",
        "src/cli/**/*.ts",
        "src/server/**/*.ts",
        "test/**",
        "migration/**",
      ],
    },
  },
})
