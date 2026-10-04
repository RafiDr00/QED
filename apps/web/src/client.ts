/**
 * The only module Vite bundles for this site, and it exists to pull the
 * stylesheets and the fonts into the build graph. No component ships: every
 * page is rendered to HTML by prerender.ts, so the browser runs no framework.
 */
import "@qed/tokens/tokens.css";
import "@qed/ui/ui.css";
import "./web.css";
