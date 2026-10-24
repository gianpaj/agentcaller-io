import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    include: ["e2e/**/*.test.mjs"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
