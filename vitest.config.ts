import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", "coverage", "data-raw", "data", "images"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["scripts/**/*.ts", "src/**/*.ts"],
      exclude: ["scripts/list-top.py"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 70,
        statements: 80,
      },
    },
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "~": __dirname,
    },
  },
});
