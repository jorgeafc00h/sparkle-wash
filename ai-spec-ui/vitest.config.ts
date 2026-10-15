import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/unit_tests/*.test.tsx", "src/integration/**/*.spec.ts"],
    testTimeout: 15000,
    setupFiles: "./fixtures/setup.js",
  },
});

// Setup file for vitest fixtures
import { readFileSync } from "fs";
import path from "path";

const setupContent = readFileSync(
  path.join(__dirname, "fixtures/setup.js"),
  "utf-8"
);
eval(setupContent);
