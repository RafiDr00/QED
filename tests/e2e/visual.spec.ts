import { expect, test } from "@playwright/test";

/**
 * Visual regression. Every component in the index, in both themes, against a
 * committed baseline. A change that moves a pixel has to be looked at and
 * accepted deliberately.
 */

const GALLERY = "http://localhost:4313";
const THEMES = ["void", "paper"] as const;

for (const theme of THEMES) {
  test(`every component matches its ${theme} baseline`, async ({ page }) => {
    await page.goto(`${GALLERY}/`, { waitUntil: "load" });
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);

    const shots = await page.locator("[data-shot]").all();
    expect(shots.length).toBeGreaterThan(0);

    for (const shot of shots) {
      const name = await shot.getAttribute("data-shot");
      if (name === null) continue;
      await expect(shot).toHaveScreenshot(`${name}.${theme}.png`);
    }
  });
}
