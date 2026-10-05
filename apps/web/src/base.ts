/**
 * The path the site is served from.
 *
 * Read once, at build time - these pages are rendered to HTML by
 * prerender.ts and ship no JavaScript, so this never runs in a browser. Every
 * in-page link goes through `href` so that a site at /QED/ does not send its
 * readers to the root of the host.
 */
const raw =
  typeof process === "undefined" ? "/" : (process.env["QED_BASE"] ?? "/");

export const BASE = raw.endsWith("/") ? raw : `${raw}/`;

/** `href("docs/")` -> "/docs/" or "/QED/docs/". */
export function href(path: string): string {
  return `${BASE}${path.replace(/^\//, "")}`;
}
