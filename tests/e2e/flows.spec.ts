import { expect, test, type Page } from "@playwright/test";

import { rawColor } from "@qed/tokens";
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

  // The abstain rate is on the home page, not in a footnote.
  await expect(page.getByText("ABSTAIN RATE", { exact: true })).toBeVisible();
  await expect(page.getByText("31%")).toBeVisible();

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
