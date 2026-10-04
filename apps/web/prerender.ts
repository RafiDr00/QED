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
import { THEME_BOOTSTRAP } from "@qed/ui";

import { Docs } from "./src/Docs.js";
import { Home } from "./src/Home.js";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");

/** Attaches the header toggle. Separate from the bootstrap, which runs in <head>. */
const TOGGLE_SCRIPT = `(function(){var b=document.getElementById("qed-theme-toggle");if(!b)return;var L={void:"Void",paper:"Paper"};function s(){var t=document.documentElement.getAttribute("data-theme")==="paper"?"paper":"void";var n=t==="void"?"paper":"void";b.textContent=L[n];b.setAttribute("aria-label","Switch to "+L[n]+" theme (currently "+L[t]+")")}b.addEventListener("click",function(){var t=document.documentElement.getAttribute("data-theme")==="paper"?"paper":"void";var n=t==="void"?"paper":"void";document.documentElement.setAttribute("data-theme",n);try{localStorage.setItem("qed-theme",n)}catch(e){}s()});s()})();`;

interface Page {
  readonly out: string;
  readonly title: string;
  readonly description: string;
  readonly element: ReactElement;
}

const PAGES: Page[] = [
  {
    out: "index.html",
    title: "QED - Proven, or it says so",
    description:
      "QED runs the function you changed against the one it replaces and reports one of three verdicts, with the evidence attached.",
    element: createElement(Home),
  },
  {
    out: "docs/index.html",
    title: "QED - Documentation",
    description:
      "Install QED, run it against a base branch, and read what it signs.",
    element: createElement(Docs),
  },
];

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

function renderPage(page: Page, html: string): string {
  const body = renderToStaticMarkup(page.element);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${page.title}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${page.description}" />`,
    )
    .replace('<div id="root"></div>', body);
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

  // Preload the two faces the first screen actually uses. latin-ext loads on
  // demand; preloading it would cost 27KB nobody reads.
  const preloads = readdirSync(join(dist, "assets"))
    .filter((f) => /-latin-[^.]*\.woff2$/.test(f))
    .map(
      (f) =>
        `  <link rel="preload" as="font" type="font/woff2" href="/assets/${f}" crossorigin />`,
    )
    .join("\n");

  const withoutScript = raw
    .replace(scriptTag, "")
    .replace("</head>", `${preloads}\n  </head>`)
    .replace(
      "</head>",
      `  <script>${THEME_BOOTSTRAP}</script>\n  </head>`,
    )
    .replace("</body>", `  <script>${TOGGLE_SCRIPT}</script>\n  </body>`);

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

  const assets = join(dist, "assets");
  const listed = readdirSync(assets);
  process.stdout.write(
    `prerendered ${PAGES.length} pages; ${listed.length} assets; client JS removed\n`,
  );
}

main();
