/**
 * Builds the marketing site as static HTML.
 *
 * Vite builds the stylesheet and the fonts; React renders the pages here, at
 * build time, and the module script Vite injected is removed afterwards. What
 * ships is HTML, CSS, woff2 and one inline script that sets [data-theme]
 * before first paint. G9 asserts the result stays under 40KB of gzipped JS -
 * it is currently a few hundred bytes.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rawColor } from "@qed/tokens";
import { THEME_BOOTSTRAP } from "@qed/ui";

import { Docs } from "./src/Docs.js";
import { Home } from "./src/Home.js";
import { NotFound } from "./src/NotFound.js";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");

/** Attaches the header toggle. Separate from the bootstrap, which runs in <head>. */
const TOGGLE_SCRIPT = `(function(){var b=document.getElementById("qed-theme-toggle");if(!b)return;var L={void:"Void",paper:"Paper"};function s(){var t=document.documentElement.getAttribute("data-theme")==="paper"?"paper":"void";var n=t==="void"?"paper":"void";b.textContent=L[n];b.setAttribute("aria-label","Switch to "+L[n]+" theme (currently "+L[t]+")")}b.addEventListener("click",function(){var t=document.documentElement.getAttribute("data-theme")==="paper"?"paper":"void";var n=t==="void"?"paper":"void";document.documentElement.setAttribute("data-theme",n);try{localStorage.setItem("qed-theme",n)}catch(e){}s()});s()})();`;

interface Page {
  readonly out: string;
  /** Path below the site root, for canonical URLs and the sitemap. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly element: ReactElement;
}

/** Where the site is served from. "/" unless the host puts it on a path. */
const BASE = process.env["QED_BASE"] ?? "/";
/** The origin the canonical URLs and the sitemap point at. */
const SITE = (process.env["QED_SITE_URL"] ?? "https://qed.dev").replace(/\/$/, "");

const absolute = (path: string) =>
  `${SITE}${`${BASE}${path}`.replace(/\/{2,}/g, "/")}`;

const PAGES: Page[] = [
  {
    out: "index.html",
    path: "",
    title: "QED - Proven, or it says so",
    description:
      "QED runs the function you changed against the one it replaces and reports one of three verdicts, with the evidence attached.",
    element: createElement(Home),
  },
  {
    out: "docs/index.html",
    path: "docs/",
    title: "QED - Documentation",
    description:
      "Install QED, run it against a base branch, and read what it signs.",
    element: createElement(Docs),
  },
  {
    out: "404.html",
    path: "404.html",
    title: "QED - Not found",
    description: "That page does not exist.",
    element: createElement(NotFound),
  },
];

/** The 404 is served, not crawled. */
const SITEMAP_PAGES = PAGES.filter((page) => page.out !== "404.html");

function build(): void {
  const result = spawnSync("pnpm", ["exec", "vite", "build"], {
    cwd: here,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function template(): string {
  return readFileSync(join(dist, "index.html"), "utf8");
}

/**
 * What a link to this page shows when it is pasted somewhere. A marketing page
 * without these is a bare URL in every chat window it travels through.
 */
function metaFor(page: Page): string {
  const url = absolute(page.path);
  const image = absolute("og.png");
  return [
    `  <link rel="canonical" href="${url}" />`,
    `  <meta property="og:type" content="website" />`,
    `  <meta property="og:site_name" content="QED" />`,
    `  <meta property="og:url" content="${url}" />`,
    `  <meta property="og:title" content="${page.title}" />`,
    `  <meta property="og:description" content="${page.description}" />`,
    `  <meta property="og:image" content="${image}" />`,
    `  <meta property="og:image:width" content="1200" />`,
    `  <meta property="og:image:height" content="630" />`,
    `  <meta property="og:image:alt" content="A QED run: three verdicts with their evidence." />`,
    `  <meta name="twitter:card" content="summary_large_image" />`,
    `  <meta name="twitter:title" content="${page.title}" />`,
    `  <meta name="twitter:description" content="${page.description}" />`,
    `  <meta name="twitter:image" content="${image}" />`,
    `  <meta name="theme-color" content="${rawColor["bg"]?.["void"] ?? ""}" media="(prefers-color-scheme: dark)" />`,
    `  <meta name="theme-color" content="${rawColor["bg"]?.["paper"] ?? ""}" media="(prefers-color-scheme: light)" />`,
    `  <link rel="apple-touch-icon" href="${BASE}apple-touch-icon.png" />`,
    `  <link rel="icon" href="${BASE}favicon-32.png" sizes="32x32" type="image/png" />`,
  ].join("\n");
}

function renderPage(page: Page, html: string): string {
  const body = renderToStaticMarkup(page.element);
  // The toggle script goes immediately after the header, which only exists
  // once the page body has been rendered in - the button ships labelled for
  // Void, and a reader whose stored theme is Paper would otherwise read the
  // wrong word until the whole document had parsed.
  const withToggle = body.replace(
    "</header>",
    `</header><script>${TOGGLE_SCRIPT}</script>`,
  );
  if (!withToggle.includes(TOGGLE_SCRIPT)) {
    throw new Error(`${page.out}: no </header> to attach the theme toggle to`);
  }
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${page.title}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${page.description}" />
${metaFor(page)}`,
    )
    .replace('<div id="root"></div>', withToggle);
}

function main(): void {
  build();

  // Vite emits a module script for src/client.ts; the CSS link it injected is
  // what we wanted. Drop the script tag and the chunk itself.
  const raw = template();
  const scriptTag = /<script type="module"[^>]*><\/script>\s*/g;
  const emittedScripts = [...raw.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((src): src is string => src !== undefined);

  // Preload the two faces the first screen actually uses. The pattern excludes
  // latin-ext, whose hashed name has a second "-" segment: preloading it costs
  // 27KB on a screen that never asks for those glyphs.
  const preloads = readdirSync(join(dist, "assets"))
    .filter((f) => /-latin-[A-Za-z0-9_]+\.woff2$/.test(f))
    .map(
      (f) =>
        `  <link rel="preload" as="font" type="font/woff2" href="${BASE}assets/${f}" crossorigin />`,
    )
    .join("\n");

  const withoutScript = raw
    .replace(scriptTag, "")
    .replace("</head>", `${preloads}\n  </head>`)
    .replace(
      "</head>",
      `  <script>${THEME_BOOTSTRAP}</script>\n  </head>`,
    )
;

  for (const page of PAGES) {
    const target = join(dist, page.out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderPage(page, withoutScript), "utf8");
  }

  for (const src of emittedScripts) {
    const file = join(dist, src.replace(/^\//, ""));
    rmSync(file, { force: true });
    rmSync(`${file}.map`, { force: true });
  }

  // robots.txt and a sitemap: a static site that wants to be found needs both,
  // and they have to know the base and the origin like everything else.
  writeFileSync(
    join(dist, "robots.txt"),
    `User-agent: *
Allow: /

Sitemap: ${absolute("sitemap.xml")}
`,
    "utf8",
  );
  writeFileSync(
    join(dist, "sitemap.xml"),
    [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      ...SITEMAP_PAGES.map(
        (page) => `  <url><loc>${absolute(page.path)}</loc></url>`,
      ),
      `</urlset>`,
      ``,
    ].join("\n"),
    "utf8",
  );

  const assets = join(dist, "assets");
  const listed = readdirSync(assets);
  process.stdout.write(
    `prerendered ${PAGES.length} pages; ${listed.length} assets; client JS removed\n`,
  );
}

main();
