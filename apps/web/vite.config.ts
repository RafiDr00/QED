import { defineConfig } from "vite";

/**
 * The marketing site ships no JavaScript beyond a theme bootstrap, so there is
 * no React plugin here: this build exists to produce the stylesheet and the
 * font files. prerender.ts renders the pages to HTML afterwards.
 */
export default defineConfig({
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
