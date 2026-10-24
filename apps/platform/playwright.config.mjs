import { defineConfig } from "@playwright/test";

if (!process.env.E2E_CONTROL_URL)
  throw new Error("Use pnpm test:stripe-e2e so this suite owns its runtime");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.mjs",
  workers: 1,
  outputDir: process.env.E2E_OUTPUT_DIR,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL,
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
  },
});
