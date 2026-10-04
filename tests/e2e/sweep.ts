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
