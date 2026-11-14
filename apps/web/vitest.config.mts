import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    // Per-test time limit, 2 min (rule time-limits, krizaka-internal#2007).
    testTimeout: 120_000,
    include: ["lib/**/*.test.{ts,tsx}", "tests/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.tsx"],
    environment: "node",
    // The lcov report SonarCloud reads (sonar-project.properties, ci.yml sonar-coverage-paths): runtime code only, never the tests.
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text-summary"],
      include: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "proxy.ts"],
      exclude: ["**/*.test.*", "**/*.d.ts"],
    },
  },
});
