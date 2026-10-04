import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { compareBitmaps, decodePng } from "../../scripts/png.ts";

/**
 * The lockup is composed here rather than shipped from `qed-logotype.svg`,
 * because that file bakes in the smoothed mark and the mark inside a lockup is
 * 0.42x its height - so the shipped file draws the smoothed geometry at 10px
 * in a 24px header, which the Logotype README forbids.
 *
 * Composing it is only defensible if it is otherwise identical to the file.
 * At `xl` the mark inside is 40.7px, where the smoothed mark is the right one,
 * so the composed lockup and the file must agree pixel for pixel. If the
 * wordmark, the gap or the baseline alignment drifted, this is what catches it.
 */

const GALLERY = "http://localhost:4313";

test("the composed lockup is the design system's logotype, pixel for pixel", async ({
  page,
}) => {
  await page.goto(`${GALLERY}/`, { waitUntil: "load" });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "void");
  });
  await page.evaluate(() => document.fonts.ready);

  const composed = decodePng(
    await page.locator("[data-lockup-composed]").screenshot(),
  );
  const shipped = decodePng(await page.locator("[data-lockup-file]").screenshot());

  writeFileSync(
    join(process.cwd(), ".verify", "shots", "lockup-composed.png"),
    await page.locator("[data-lockup-composed]").screenshot(),
  );
  writeFileSync(
    join(process.cwd(), ".verify", "shots", "lockup-file.png"),
    await page.locator("[data-lockup-file]").screenshot(),
  );

  const diff = compareBitmaps(composed, shipped, 24);
  expect(
    diff.dimensionsMatch,
    `composed ${composed.width}x${composed.height}, file ${shipped.width}x${shipped.height}`,
  ).toBe(true);

  // Antialiasing along the curves differs by a hair between an inline <svg>
  // and an <img>; the geometry does not.
  expect(
    diff.ratio,
    "the composed lockup has drifted from the shipped logotype",
  ).toBeLessThan(0.02);
});
