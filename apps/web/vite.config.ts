import { defineConfig } from "vite";

/**
 * The marketing site ships no JavaScript beyond a theme bootstrap, so there is
 * no React plugin here: this build exists to produce the stylesheet and the
 * font files. prerender.ts renders the pages to HTML afterwards.
 *
 * QED_BASE sets the path the site is served from - "/" for a domain of its
 * own, "/QED/" for a GitHub Pages project site. Everything that emits a URL
 * reads it, so there is one place to change.
 */
export const base = process.env["QED_BASE"] ?? "/";

export default defineConfig({
  base,
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
