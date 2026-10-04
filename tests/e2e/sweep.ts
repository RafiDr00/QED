import type { Page } from "@playwright/test";

/**
 * Walks a rendered page and reports every text node's colour against the
 * ground it actually sits on. Runs in the browser, so it sees what the reader
 * sees rather than what the stylesheet intends.
 */

export interface SweptPair {
  selector: string;
  sample: string;
  fg: string;
  bg: string;
  fontSize: number;
  fontWeight: number;
}

export interface SweepResult {
  pairs: SweptPair[];
  textColours: { color: string; selector: string }[];
}

/**
 * The verdict glyphs carry meaning through an SVG `fill`, which the text sweep
 * never sees because it reads `color`. WCAG 1.4.11 applies to them: they are
 * non-text content that conveys state.
 */
export async function sweepGlyphFills(page: Page): Promise<SweptPair[]> {
  return page.evaluate(() => {
    const OPAQUE = (value: string) =>
      value !== "" &&
      value !== "transparent" &&
      !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(value);

    const out: SweptPair[] = [];
    const seen = new Set<string>();

    for (const glyph of Array.from(document.querySelectorAll("svg.qed-dot"))) {
      const fill = getComputedStyle(glyph).fill;
      let ground = "";
      let current: Element | null = glyph.parentElement;
      while (current) {
        const background = getComputedStyle(current).backgroundColor;
        if (OPAQUE(background)) {
          ground = background;
          break;
        }
        current = current.parentElement;
      }
      if (ground === "") ground = getComputedStyle(document.body).backgroundColor;

      const state = glyph.getAttribute("data-state") ?? "unknown";
      const key = `${fill}|${ground}|${state}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        selector: `svg.qed-dot[${state}]`,
        sample: state,
        fg: fill,
        bg: ground,
        // Non-text: 3:1. Reported through the large-text threshold.
        fontSize: 24,
        fontWeight: 400,
      });
    }
    return out;
  });
}

/**
 * Hover and active states, which the resting sweep cannot see. A link that
 * turns unreadable on hover is still unreadable.
 */
export async function sweepHoverStates(
  page: Page,
  limit = 14,
): Promise<SweptPair[]> {
  const out: SweptPair[] = [];
  // WCAG 1.4.3 exempts a disabled control, hovered or not.
  const targets = await page
    .locator("a:visible, button:visible:not(:disabled)")
    .all();

  for (const target of targets.slice(0, limit)) {
    try {
      await target.hover({ timeout: 1000 });
    } catch {
      continue;
    }
    const pair = await target.evaluate((el) => {
      const OPAQUE = (value: string) =>
        value !== "" &&
        value !== "transparent" &&
        !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(value);
      const style = getComputedStyle(el);
      let ground = OPAQUE(style.backgroundColor) ? style.backgroundColor : "";
      let current: Element | null = el.parentElement;
      while (ground === "" && current) {
        const background = getComputedStyle(current).backgroundColor;
        if (OPAQUE(background)) ground = background;
        current = current.parentElement;
      }
      if (ground === "") ground = getComputedStyle(document.body).backgroundColor;
      return {
        selector: `${el.tagName.toLowerCase()}:hover`,
        sample: el.textContent.trim().slice(0, 40),
        fg: style.color,
        bg: ground,
        fontSize: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight) || 400,
      };
    });
    if (pair.sample !== "") out.push(pair);
  }

  // Leave the pointer somewhere harmless so the next sweep is a resting one.
  await page.mouse.move(0, 0);
  return out;
}

export async function sweepContrast(page: Page): Promise<SweepResult> {
  return page.evaluate(() => {
    const OPAQUE = (value: string) =>
      value !== "" &&
      value !== "transparent" &&
      !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(value);

    function describe(element: Element): string {
      const parts: string[] = [];
      let current: Element | null = element;
      let depth = 0;
      while (current && depth < 3) {
        const tag = current.tagName.toLowerCase();
        const cls = current.getAttribute("class");
        const first = cls?.split(/\s+/).find((c) => c.length > 0);
        parts.unshift(first === undefined ? tag : `${tag}.${first}`);
        current = current.parentElement;
        depth++;
      }
      return parts.join(" > ");
    }

    function groundOf(element: Element): string {
      let current: Element | null = element;
      while (current) {
        const background = getComputedStyle(current).backgroundColor;
        if (OPAQUE(background)) return background;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }

    const pairs: SweptPair[] = [];
    const textColours: { color: string; selector: string }[] = [];
    const seen = new Set<string>();

    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      if (element instanceof HTMLScriptElement || element instanceof HTMLStyleElement) {
        continue;
      }
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // WCAG 1.4.3 exempts text in a disabled control.
      if (element.closest(":disabled") !== null) continue;
      // Skip the visually-hidden helper: it is for screen readers only.
      if (element.classList.contains("qed-visually-hidden")) continue;
      if ((element as HTMLElement).offsetParent === null && style.position !== "fixed") {
        // Off-screen (the skip link at rest). Still record its colour pair,
        // because it becomes visible on focus.
        if (!element.classList.contains("qed-skip-link")) continue;
      }

      const own = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (own === "") continue;

      const fg = style.color;
      const bg = groundOf(element);
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = Number(style.fontWeight) || 400;
      const selector = describe(element);

      textColours.push({ color: fg, selector });

      const key = `${fg}|${bg}|${fontSize}|${fontWeight}|${selector}`;
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push({
        selector,
        sample: own.slice(0, 60),
        fg,
        bg,
        fontSize,
        fontWeight,
      });
    }

    return { pairs, textColours };
  });
}
