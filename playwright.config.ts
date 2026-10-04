import { defineConfig, devices } from "@playwright/test";

/**
 * Three servers: the built marketing site, the built console, and the
 * component index the evidence run shoots. The first two are the real build
 * output - a gate that passes against a dev server proves less.
 *
 * Visual baselines are per-platform, and the committed ones are Windows.
 * CI runs on Linux, where Playwright would have no baseline to compare
 * against - and a run that writes the baseline it then passes against proves
 * nothing. So CI skips the visual spec and says so, and visual regression
 * stays a gate you run locally. To put it in CI, generate Linux baselines
 * once in the official Playwright container and commit them beside the
 * Windows ones; see README, "Visual regression".
 */
const skipVisual = process.env["QED_SKIP_VISUAL"] === "1";

export default defineConfig({
  testDir: "tests/e2e",
  ...(skipVisual ? { testIgnore: ["**/visual.spec.ts"] } : {}),
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
