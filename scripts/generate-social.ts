/**
 * Renders the social card and the raster icons.
 *
 * All three come from the real thing: the card is the mark and the wordmark
 * over the Void ground with the hero line, the icons are `qed-mark-16.svg`
 * rasterised. Nothing here is redrawn, so a change to the logo or the palette
 * reaches them by rebuilding rather than by somebody remembering.
 *
 * Run: pnpm generate:social
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { chromium } from "@playwright/test";
import { rawColor } from "@qed/tokens";

const root = process.cwd();
const publicDir = join(root, "apps/web/public");
const logoDir = join(root, "packages/ui/src/assets/logos");

const ink = (token: string) => rawColor[token]?.["void"] ?? "";

function card(): string {
  const wordmark = readFileSync(join(logoDir, "qed-logotype.svg"), "utf8");
  const css = readFileSync(
    join(root, "packages/tokens/dist/tokens.css"),
    "utf8",
  );
  const fonts = readFileSync(
    join(root, "packages/ui/src/styles/fonts.css"),
    "utf8",
  ).replace(/url\("\.\.\/assets\/fonts\//g, `url("file:///${logoDir.replace(/\\/g, "/").replace("/logos", "")}/fonts/`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
${css}
${fonts}
html, body { margin: 0; }
body {
  width: 1200px; height: 630px;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-text);
  display: flex; flex-direction: column; justify-content: center;
  align-items: flex-start;
  padding: 0 96px; box-sizing: border-box; gap: 48px;
}
.mark { height: 96px; width: auto; }
h1 {
  margin: 0;
  font-size: 88px; line-height: 88px; font-weight: 700;
  letter-spacing: -0.035em;
}
p {
  margin: 0; color: var(--ink-muted);
  font-family: var(--font-data); font-size: 24px; line-height: 32px;
}
.rule { height: 2px; background: var(--proof); width: 128px; }
</style></head>
<body>
  ${wordmark.replace("<svg", '<svg class="mark"')}
  <h1>Proven, or it says so.</h1>
  <div class="rule"></div>
  <p>Three verdicts. Every one with its evidence.</p>
</body></html>`;
}

function iconPage(sizePx: number): string {
  const svg = readFileSync(join(logoDir, "qed-mark-16.svg"), "utf8");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: ${ink("bg")}; }
body { width: ${sizePx}px; height: ${sizePx}px; display: grid; place-items: center; }
svg { width: ${Math.round(sizePx * 0.75)}px; height: ${Math.round(sizePx * 0.75)}px; }
</style></head><body>${svg}</body></html>`;
}

async function main(): Promise<void> {
  mkdirSync(publicDir, { recursive: true });
  const browser = await chromium.launch();

  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(card(), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const cardFile = join(publicDir, "og.png");
  mkdirSync(dirname(cardFile), { recursive: true });
  writeFileSync(cardFile, await page.screenshot());
  await page.close();

  for (const [name, size] of [
    ["favicon-32.png", 32],
    ["apple-touch-icon.png", 180],
  ] as const) {
    const icon = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await icon.setContent(iconPage(size), { waitUntil: "load" });
    writeFileSync(join(publicDir, name), await icon.screenshot());
    await icon.close();
  }

  await browser.close();
  process.stdout.write("apps/web/public: og.png, favicon-32.png, apple-touch-icon.png\n");
}

await main();
