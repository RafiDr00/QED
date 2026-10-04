import { defineConfig, devices } from "@playwright/test";

/**
 * Three servers: the built marketing site, the built console, and the
 * component index the evidence run shoots. The first two are the real build
 * output - a gate that passes against a dev server proves less.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: {
      // Font rasterisation differs by a hair between runs; shape changes do not.
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @qed/web preview",
      url: "http://localhost:4311/",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @qed/console preview",
      url: "http://localhost:4312/",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
    },
    {
      command: "pnpm exec vite --config tests/gallery/vite.config.ts",
      url: "http://localhost:4313/",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
    },
  ],
});
