/** WCAG 2.2 colour maths. Used by the contrast gate and by the e2e evidence run. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex?.[1]) {
    const h = hex[1];
    const expand = (s: string) => parseInt(s.repeat(2 / s.length), 16);
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [h[0], h[1], h[2], h[3]];
      if (r === undefined || g === undefined || b === undefined) return null;
      return {
        r: expand(r),
        g: expand(g),
        b: expand(b),
        a: a === undefined ? 1 : expand(a) / 255,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  if (fn?.[1]) {
    const parts = fn[1]
      .replace(/\//g, " ")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((p) => (p.endsWith("%") ? Number(p.slice(0, -1)) * 2.55 : Number(p)));
    const [r, g, b, a] = parts;
    if (r === undefined || g === undefined || b === undefined) return null;
    return { r, g, b, a: a === undefined ? 1 : a > 1 ? a / 255 : a };
  }

  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgb): number {
  return (
    0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
  );
}

/** Flatten a translucent colour onto an opaque ground. */
export function over(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

export function contrast(fg: Rgb, bg: Rgb): number {
  const f = fg.a < 1 ? over(fg, bg) : fg;
  const l1 = luminance(f);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastHex(fg: string, bg: string): number {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) throw new Error(`unparseable colour pair: ${fg} on ${bg}`);
  return contrast(f, b);
}

/** WCAG 1.4.3: 3:1 for large text (>=24px, or >=18.66px at weight >=700). */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

export function requiredRatio(fontSizePx: number, fontWeight: number): number {
  return isLargeText(fontSizePx, fontWeight) ? 3 : 4.5;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
