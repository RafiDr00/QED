import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { rawColor } from "@qed/tokens";
import { expect, test, type Page } from "@playwright/test";

import { contrast, parseColor, requiredRatio, round2 } from "../../scripts/color.ts";
import { compareBitmaps, cropToBitmap, decodePng } from "../../scripts/png.ts";
import { sweepContrast } from "./sweep.ts";

/**
 * The evidence run. It produces the files verify.ts reads for G1, G5, G6, G8
 * and G10 - not assertions in a report nobody opens, but JSON a gate can fail
 * on.
 */

const VERIFY = join(process.cwd(), ".verify");
const SHOTS = join(VERIFY, "shots");

const WEB = "http://localhost:4311";
const CONSOLE = "http://localhost:4312";
const GALLERY = "http://localhost:4313";

const THEMES = ["void", "paper"] as const;
type Theme = (typeof THEMES)[number];

const ROUTES = [
  { name: "web-home", url: `${WEB}/` },
  { name: "web-docs", url: `${WEB}/docs/` },
  { name: "console-run", url: `${CONSOLE}/#/run` },
  { name: "console-verdicts", url: `${CONSOLE}/#/verdicts` },
  { name: "console-attestations", url: `${CONSOLE}/#/attestations` },
  { name: "console-release", url: `${CONSOLE}/#/release` },
  { name: "console-export", url: `${CONSOLE}/#/export` },
  { name: "gallery", url: `${GALLERY}/` },
] as const;

async function open(page: Page, url: string, theme: Theme): Promise<void> {
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(80);
}

/**
 * Crops every bitmap to the largest box they all share, then compares each
 * pair. Cropping each one to its own square independently left them different
 * sizes, which the comparison could not do anything useful with.
 */
function comparePairwise(
  bitmaps: Map<string, ReturnType<typeof decodePng>>,
  tolerance: number,
): { a: string; b: string; ratio: number; dimensionsMatch: boolean }[] {
  const all = [...bitmaps.values()];
  const width = Math.min(...all.map((b) => b.width));
  const height = Math.min(...all.map((b) => b.height));
  const cropped = new Map(
    [...bitmaps].map(([name, bitmap]) => [
      name,
      cropToBitmap(bitmap, 0, 0, width, height),
    ]),
  );

  const states = [...cropped.keys()];
  const out: { a: string; b: string; ratio: number; dimensionsMatch: boolean }[] =
    [];
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i];
      const b = states[j];
      const left = a === undefined ? undefined : cropped.get(a);
      const right = b === undefined ? undefined : cropped.get(b);
      if (a === undefined || b === undefined || !left || !right) continue;
      const comparison = compareBitmaps(left, right, tolerance);
      out.push({
        a,
        b,
        ratio: comparison.ratio,
        dimensionsMatch: comparison.dimensionsMatch,
      });
    }
  }
  return out;
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test("contrast, a11y and screenshots across every route and both themes", async ({
  page,
}) => {
  const pairs: unknown[] = [];
  const textColoursUsed: { theme: string; color: string; selector: string }[] = [];
  const axeRuns: unknown[] = [];
  const shots: { name: string; theme: string; file: string }[] = [];

  for (const theme of THEMES) {
    for (const route of ROUTES) {
      await open(page, route.url, theme);

      const swept = await sweepContrast(page);
      for (const pair of swept.pairs) {
        const fg = parseColor(pair.fg);
        const bg = parseColor(pair.bg);
        if (!fg || !bg) continue;
        const ratio = contrast(fg, bg);
        const required = requiredRatio(pair.fontSize, pair.fontWeight);
        pairs.push({
          route: route.name,
          theme,
          selector: pair.selector,
          sample: pair.sample,
          fg: pair.fg,
          bg: pair.bg,
          fontSize: pair.fontSize,
          fontWeight: pair.fontWeight,
          ratio: round2(ratio),
          required,
          ok: ratio >= required - 0.005,
        });
      }
      for (const used of swept.textColours) {
        textColoursUsed.push({ theme, ...used });
      }

      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      axeRuns.push({
        route: route.name,
        theme,
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact ?? "unknown",
          nodes: v.nodes.length,
          help: v.help,
        })),
      });

      if (route.name === "gallery") {
        for (const handle of await page.locator("[data-shot]").all()) {
          const name = await handle.getAttribute("data-shot");
          if (name === null) continue;
          // The FocusRing shot is pointless unless something is focused in it.
          if (name === "FocusRing") {
            await handle.locator("a").first().focus();
          }
          const file = join(".verify", "shots", `${name}.${theme}.png`);
          await handle.screenshot({ path: join(process.cwd(), file) });
          shots.push({ name, theme, file: file.split("\\").join("/") });
        }
      }
    }
  }

  writeFileSync(
    join(VERIFY, "contrast.json"),
    `${JSON.stringify({ pairs, textColoursUsed }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(VERIFY, "axe.json"),
    `${JSON.stringify({ runs: axeRuns }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(VERIFY, "screenshots.json"),
    `${JSON.stringify({ shots }, null, 2)}\n`,
    "utf8",
  );

  expect(shots.length).toBeGreaterThan(0);
});

/**
 * Four device pixels per CSS pixel: the mark still renders at 16px, but the
 * cut is measured on a raster fine enough that the answer is about geometry
 * rather than about antialiasing on an 8-pixel edge.
 */
test.describe("mark optics", () => {
  test.use({ deviceScaleFactor: 4 });

  test("the mark reads at every size it ships at", async ({ page }) => {
    await open(page, `${GALLERY}/`, "void");

    const renders: {
      size: number;
      variant: string;
      cutEdgeFraction: number;
      cutSideFraction: number;
      cornerIsSquare: boolean;
      inkFraction: number;
    }[] = [];

    // The mark is drawn in `proof` on the page ground; classify by colour
    // rather than by alpha, which an opaque page makes meaningless.
    const proof = parseColor(rawColor["proof"]?.["void"] ?? "#000000");
    expect(proof).not.toBeNull();
    const isInk = (bitmap: ReturnType<typeof decodePng>, index: number) => {
      const d = index * 4;
      const dr = (bitmap.data[d] ?? 0) - (proof?.r ?? 0);
      const dg = (bitmap.data[d + 1] ?? 0) - (proof?.g ?? 0);
      const db = (bitmap.data[d + 2] ?? 0) - (proof?.b ?? 0);
      return Math.sqrt(dr * dr + dg * dg + db * db) < 110;
    };

    for (const holder of await page.locator("[data-mark]").all()) {
      const size = Number(await holder.getAttribute("data-mark"));
      const svg = holder.locator("svg");
      const variant = (await svg.getAttribute("data-logo")) ?? "unknown";

      const bitmap = decodePng(await svg.screenshot({ scale: "device" }));

      let minX = bitmap.width;
      let maxX = -1;
      let minY = bitmap.height;
      let maxY = -1;
      let ink = 0;
      for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
          if (!isInk(bitmap, y * bitmap.width + x)) continue;
          ink++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      expect(maxX, `nothing rendered at ${size}px`).toBeGreaterThan(0);

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;

      // Along the bottom edge of the mark, how much of the right-hand half has
      // been cut away? A mark whose cut failed to render scores 0.
      const bottom = maxY;
      const halfWidth = Math.floor(boxWidth / 2);
      let cut = 0;
      for (let x = minX + halfWidth; x <= maxX; x++) {
        if (!isInk(bitmap, bottom * bitmap.width + x)) cut++;
      }

      // How much of the whole bottom edge is gone, counted from the right.
      // The design system states 46% for the smoothed mark and 52% for the
      // small one; this is what tells those two files apart.
      let cutFromRight = 0;
      for (let x = maxX; x >= minX; x--) {
        if (isInk(bitmap, bottom * bitmap.width + x)) break;
        cutFromRight++;
      }

      // The smoothed mark rounds its corners at 5.5% of the side; the small
      // one squares them. Sample the corner pixel itself.
      const cornerIsSquare = isInk(bitmap, minY * bitmap.width + minX);

      renders.push({
        size,
        variant,
        cutEdgeFraction: halfWidth === 0 ? 0 : cut / halfWidth,
        cutSideFraction: boxWidth === 0 ? 0 : cutFromRight / boxWidth,
        cornerIsSquare,
        inkFraction: ink / (boxWidth * boxHeight),
      });
    }

    writeFileSync(
      join(VERIFY, "mark-optics.json"),
      `${JSON.stringify({ renders }, null, 2)}\n`,
      "utf8",
    );
    expect(renders.length).toBe(4);
  });
});

/**
 * The glyphs again, at the 9px they actually ship at. The large comparison
 * proves the three shapes are different; this one proves the difference
 * survives the size the design system specifies, which is the question that
 * matters to a reader.
 */
test.describe("glyphs at the size they ship at", () => {
  test.use({ deviceScaleFactor: 4 });

  test("the three verdict dots differ as shapes at 9px", async ({ page }) => {
    await open(page, `${GALLERY}/`, "void");
    await page.addStyleTag({ content: "html { filter: grayscale(1) !important; }" });

    const bitmaps = new Map<string, ReturnType<typeof decodePng>>();
    for (const holder of await page.locator("[data-glyph]").all()) {
      const state = (await holder.getAttribute("data-glyph")) ?? "unknown";
      const buffer = await holder
        .locator("svg.qed-dot")
        .screenshot({ scale: "device" });
      writeFileSync(
        join(process.cwd(), ".verify", "shots", `dot9-${state}.png`),
        buffer,
      );
      bitmaps.set(state, decodePng(buffer));
    }

    const shippedSize = comparePairwise(bitmaps, 16);

    writeFileSync(
      join(VERIFY, "glyphs-9px.json"),
      `${JSON.stringify({ shippedSize }, null, 2)}\n`,
      "utf8",
    );
    expect(shippedSize.length).toBe(3);
  });
});

test("the attestation survives being printed in greyscale", async ({ page }) => {
  await open(page, `${CONSOLE}/#/attestations`, "paper");

  const pdfPath = join(VERIFY, "attestation.pdf");
  const pdf = await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" },
  });

  // Strip the colour and compare the three glyphs as shapes.
  await open(page, `${GALLERY}/`, "paper");
  await page.addStyleTag({
    content: "html { filter: grayscale(1) !important; }",
  });

  const glyphs: { state: string; file: string }[] = [];
  const bitmaps = new Map<string, ReturnType<typeof decodePng>>();

  for (const holder of await page.locator("[data-glyph-large]").all()) {
    const state = (await holder.getAttribute("data-glyph-large")) ?? "unknown";
    const dot = holder.locator("svg.qed-dot");
    const buffer = await dot.screenshot({ scale: "css" });
    const file = join(".verify", "shots", `glyph-${state}.png`);
    writeFileSync(join(process.cwd(), file), buffer);
    bitmaps.set(state, decodePng(buffer));
    glyphs.push({ state, file: file.split("\\").join("/") });
  }

  const pairwiseDifference = comparePairwise(bitmaps, 16);

  // The printed page itself: emulate print media and read the card back, so
  // the gate is not resting on the PDF's byte count alone.
  await open(page, `${CONSOLE}/#/attestations`, "void");
  await page.emulateMedia({ media: "print" });
  const printed = page.getByRole("article").first();
  // The page's own ground, not the attestation's tint: the card is deliberately
  // `proof-dim` in both themes, so reading its background would say nothing
  // about which theme printed.
  const printedGround = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  const printedRows = await printed.locator("dt").allInnerTexts();
  const printedButtons = await printed.evaluate(
    (el) =>
      [...el.querySelectorAll(".qed-button")].filter(
        (b) => getComputedStyle(b).display !== "none",
      ).length,
  );
  await page.emulateMedia({ media: "screen" });

  writeFileSync(
    join(VERIFY, "print.json"),
    `${JSON.stringify(
      {
        pdf: { file: ".verify/attestation.pdf", bytes: pdf.byteLength },
        glyphs,
        pairwiseDifference,
        printed: {
          ground: printedGround,
          rows: printedRows,
          buttons: printedButtons,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  expect(glyphs.length).toBe(3);
});
