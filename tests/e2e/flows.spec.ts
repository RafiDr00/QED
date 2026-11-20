import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { rawColor } from "@qed/tokens";
import { summarise, type QedBundle } from "@qed/ui/model";

import { EXAMPLE_BUNDLE } from "../../apps/console/src/bundle.generated.ts";

import { ABSTAIN_RATE, HERO_RUN } from "../../apps/web/src/content.ts";
import { contrastHex, parseColor } from "../../scripts/color.ts";

/** The flows that matter: finding the docs, reading a verdict, filing a record. */

const WEB = "http://localhost:4311";
const CONSOLE = "http://localhost:4312";

const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "none";
    const text = el.textContent.trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}:${text}`;
  });

test("a keyboard reaches every part of the console shell, in order", async ({
  page,
}) => {
  await page.goto(`${CONSOLE}/#/run`);
  await page.evaluate(() => document.fonts.ready);

  // 1. The skip link is first, and it works.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  // 2. From the top, the header action and then the nav, in document order.
  // A fresh load: a hash navigation would resume tabbing from the skip target.
  await page.goto(`${CONSOLE}/#/run`);
  await page.reload();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await focusedName(page)).toContain("button");

  const order: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    order.push(await focusedName(page));
  }
  expect(order.join(" | ")).toContain("Verdicts");
  expect(order.join(" | ")).toContain("Audit export");

  // 3. Every nav item is reachable and activates its view.
  for (const name of ["Verdicts", "Attestations", "Release evidence", "Audit export"]) {
    await page.getByRole("link", { name, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test("focus is visible, and it is never a verdict colour", async ({ page }) => {
  await page.goto(`${CONSOLE}/#/attestations`);

  const button = page.getByRole("button", { name: /verify independently/i }).first();
  await button.focus();

  const ring = await button.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      color: style.outlineColor,
      width: style.outlineWidth,
      offset: style.outlineOffset,
      style: style.outlineStyle,
    };
  });

  const focusToken = rawColor["focus"]?.["void"] ?? "";
  const expected = parseColor(focusToken);
  const actual = parseColor(ring.color);
  expect(actual).toEqual(expected);
  expect(ring.width).toBe("2px");
  expect(ring.offset).toBe("2px");
  expect(ring.style).not.toBe("none");

  // Not a verdict colour, and readable against the ground it lands on.
  for (const verdict of ["proof", "break", "open"]) {
    expect(ring.color).not.toBe(rawColor[verdict]?.["void"]);
  }
  expect(contrastHex(focusToken, rawColor["proof-dim"]?.["void"] ?? "#000000")).toBeGreaterThan(3);
});

test("verifying an attestation reports back", async ({ page }) => {
  await page.goto(`${CONSOLE}/#/attestations`);

  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "computeVat" }) });
  const status = card.getByRole("status");
  await expect(status).toBeAttached();
  await expect(status).toHaveText("");

  await card.getByRole("button", { name: /verify independently/i }).click();
  await expect(status).toHaveText(/Re-derived and matched at/);
});

/** The console's own bundle, edited the way a reader or a forger might. */
function edited(change: (bundle: QedBundle) => void): Buffer {
  const bundle = JSON.parse(EXAMPLE_BUNDLE) as QedBundle;
  change(bundle);
  return Buffer.from(JSON.stringify(bundle, null, 2));
}

const picker = (page: Page) => page.locator('input[type="file"]');

test("the console shows the bundle it was built with, and names it", async ({ page }) => {
  await page.goto(`${CONSOLE}/#/run`);
  await expect(page.getByTestId("bundle-source")).toContainText("the example run");
  await expect(page.getByText("examples/ledger", { exact: true })).toBeVisible();
  // The run the engine really produced, not a typed-in one.
  await expect(page.getByLabel(/command output/i).first()).toContainText("bulkRate");
});

test("a reader can open their own bundle, and a bad file is refused with the reason", async ({
  page,
}) => {
  await page.goto(`${CONSOLE}/#/verdicts`);

  await picker(page).setInputFiles({
    name: "payments.json",
    mimeType: "application/json",
    buffer: edited((bundle) => {
      (bundle as { repository: string }).repository = "acme/payments";
    }),
  });
  await expect(page.getByTestId("bundle-source")).toContainText("payments.json");
  await expect(page.getByText("acme/payments", { exact: true })).toBeVisible();

  await picker(page).setInputFiles({
    name: "not-a-bundle.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ hello: "world" })),
  });
  await expect(page.getByRole("alert")).toContainText("not-a-bundle.json was not opened.");
  // A refused file leaves the bundle that was open, open.
  await expect(page.getByTestId("bundle-source")).toContainText("payments.json");

  await page.getByRole("button", { name: "Back to the example" }).click();
  await expect(page.getByTestId("bundle-source")).toContainText("the example run");
});

test("a record edited inside a bundle fails verification in the browser", async ({ page }) => {
  await page.goto(`${CONSOLE}/#/attestations`);
  await picker(page).setInputFiles({
    name: "edited.json",
    mimeType: "application/json",
    buffer: edited((bundle) => {
      const record = bundle.records.find((r) => r.symbol === "computeVat");
      if (record) (record as unknown as { tolerances: string[] }).tolerances = ["float ε 1"];
    }),
  });

  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "computeVat" }) });
  await card.getByRole("button", { name: /verify independently/i }).click();
  await expect(card.getByRole("status")).toContainText("Do not rely on it");
  await expect(card).toHaveAttribute("data-verification", "mismatch");
});

test("the verdicts view draws where each divergence bites, with a table behind it", async ({ page }) => {
  await page.goto(`${CONSOLE}/#/verdicts`);
  const figure = page.getByRole("figure");
  await expect(figure).toHaveCount(1);
  await expect(figure).toContainText("classified inputs for bulkRate, along qty and tier");
  await expect(figure.getByRole("img")).toBeVisible();
  // Identity is never colour alone: a legend names both marks.
  await expect(figure.getByRole("list", { name: "Legend" })).toContainText("the two versions disagree");
  await figure.getByText("The same inputs as a table").click();
  await expect(figure.getByRole("table")).toContainText("disagree");
});

test("the export downloads the bundle it shows, under the digest it prints", async ({ page }) => {
  await page.goto(`${CONSOLE}/#/export`);
  const expected = `sha256:${createHash("sha256").update(EXAMPLE_BUNDLE).digest("hex")}`;
  await expect(page.getByTestId("bundle-digest")).toHaveText(expected);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download bundle" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("qed-bundle.json");
  const path = await download.path();
  expect(readFileSync(path, "utf8")).toBe(EXAMPLE_BUNDLE);
  await expect(page.getByTestId("export-status")).toContainText("Saved qed-bundle.json");
});

test("the theme survives a reload, and the first paint is already right", async ({
  page,
}) => {
  await page.goto(`${CONSOLE}/#/run`);
  await page.getByRole("button", { name: /switch to paper/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");

  // The bootstrap runs in <head>, so the attribute is set before anything is
  // painted - not after React mounts.
  await page.reload();
  const themeAtDocumentStart = await page.evaluate(
    () => document.documentElement.getAttribute("data-theme"),
  );
  expect(themeAtDocumentStart).toBe("paper");

  await page.getByRole("button", { name: /switch to void/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "void");
});

test("a reader can get from the marketing page to the install command", async ({
  page,
}) => {
  await page.goto(`${WEB}/`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Proven, or it says so.",
  );

  // The abstain rate is on the home page, not in a footnote - and it is the
  // rate of the run printed above it, not a number from somewhere else.
  await expect(page.getByText("ABSTAIN RATE", { exact: true })).toBeVisible();
  // One definition of the rate, exported by the page's own content module,
  // so the figure on the page and the figure asserted here cannot diverge.
  const summary = summarise(HERO_RUN);
  expect(ABSTAIN_RATE).toBe(
    Math.round((summary.abstained / HERO_RUN.changedFunctions) * 100),
  );
  await expect(page.getByText(`${ABSTAIN_RATE}%`).first()).toBeVisible();
  await expect(
    page.getByText(String(HERO_RUN.verifiableFunctions), { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("link", { name: "Install" }).first().click();
  await expect(page).toHaveURL(/\/docs\/#install$/);
  await expect(
    page.getByText("curl -fsSL https://qed.dev/install.sh | sh"),
  ).toBeVisible();

  await page.getByRole("link", { name: "Exit codes" }).click();
  await expect(
    page.getByText("0 - no function diverged.", { exact: false }),
  ).toBeVisible();
});

test("the marketing site works with JavaScript turned off", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${WEB}/`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Proven, or it says so.",
  );
  await expect(page.getByText("EQUIVALENT").first()).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await context.close();
});

test("the marketing site's theme toggle works, and survives a reload", async ({
  page,
}) => {
  await page.goto(`${WEB}/`);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "paper");

  // The only script on this page besides the bootstrap. It broke once by being
  // attached to markup that did not exist yet, and nothing noticed.
  await page.getByRole("button", { name: /switch to paper/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(
    page.getByRole("button", { name: /switch to void/i }),
  ).toBeVisible();

  await page.reload();
  expect(
    await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    ),
  ).toBe("paper");

  // And the docs page, which is rendered from the same template.
  await page.goto(`${WEB}/docs/`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await page.getByRole("button", { name: /switch to void/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "void");
});
