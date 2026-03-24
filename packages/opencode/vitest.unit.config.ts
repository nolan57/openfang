/**
 * Unit test configuration for OpenCode.
 *
 * Run with: bun vitest run --config vitest.unit.config.ts
 */

import { defineConfig } from "vitest/config"
import baseConfig from "./vitest.config"

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    name: "unit",

    // Unit tests only - exclude integration and e2e
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: [
      ...(baseConfig.test?.exclude ?? []),
      "src/**/*.live.test.ts",
      "src/**/*.e2e.test.ts",
      "test/**/*.live.test.ts",
      "test/**/*.e2e.test.ts",
    ],

    // Coverage for unit tests
    coverage: {
      ...baseConfig.test?.coverage,
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
      exclude: [
        ...(baseConfig.test?.coverage?.exclude ?? []),
        "src/index.ts",
        "src/cli/**/*.ts",
        "src/server/**/*.ts",
        "src/acp/**/*.ts",
      ],
    },
  },
})
