import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["e2e/**/*.test.mjs"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
