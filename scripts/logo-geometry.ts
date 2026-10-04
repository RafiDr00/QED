/**
 * Everything that defines a logo drawing: the viewBox it is drawn in, and
 * every shape in order - paths and rects both. The wordmark's two stems are
 * rects, so a baseline over `d` attributes alone would not notice them moving.
 *
 * One implementation, imported by both the script that writes the baseline and
 * the gate that checks it. Two copies agreed with each other once while both
 * were wrong, which is the same as having no check at all.
 */

const VIEWBOX = /\sviewBox="([^"]+)"/;
const SHAPE = /<(path|rect)\s([^>]*)>/g;

function attribute(attrs: string, name: string): string {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(` ${attrs}`);
  return match?.[1] ?? "";
}

export function geometryOf(svg: string): string[] {
  const parts: string[] = [`viewBox:${VIEWBOX.exec(svg)?.[1] ?? "none"}`];

  for (const m of svg.matchAll(SHAPE)) {
    const tag = m[1];
    const attrs = m[2] ?? "";
    parts.push(
      tag === "path"
        ? `path:${attribute(attrs, "d")}:${attribute(attrs, "fill-rule")}`
        : `rect:${attribute(attrs, "x")}:${attribute(attrs, "y")}:` +
          `${attribute(attrs, "width")}:${attribute(attrs, "height")}`,
    );
  }
  return parts;
}

/** The path `d` attributes alone, in order. */
export function pathDataOf(svg: string): string[] {
  return [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1] ?? "");
}
