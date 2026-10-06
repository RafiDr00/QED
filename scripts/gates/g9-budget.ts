import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { fail, pass, rel, root, walkIncludingDist, type Gate } from "./kit.ts";

// ============================================================== G9 bundle budget

const WEB_JS_BUDGET_BYTES = 40 * 1024;

export const gate: Gate = {
  id: "G9",
  title: "Bundle budget - marketing site ships under 40KB of gzipped JS",
  run() {
    const dist = join(root, "apps/web/dist");
    if (!existsSync(dist)) return fail(["apps/web/dist missing - build first"]);
    const jsFiles = walkIncludingDist(dist, (p) => extname(p) === ".js");
    let total = 0;
    const notes: string[] = [];
    for (const file of jsFiles) {
      const gz = gzipSync(readFileSync(file)).byteLength;
      total += gz;
      notes.push(`${rel(file)}: ${gz} B gzipped`);
    }

    // Inline <script> blocks count too - that is where a theme bootstrap hides.
    for (const html of walkIncludingDist(dist, (p) => extname(p) === ".html")) {
      const text = readFileSync(html, "utf8");
      for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
        const body = m[1] ?? "";
        if (body.trim().length === 0) continue;
        const gz = gzipSync(Buffer.from(body, "utf8")).byteLength;
        total += gz;
        notes.push(`${rel(html)} inline script: ${gz} B gzipped`);
      }
    }

    notes.unshift(`total ${total} B gzipped of ${WEB_JS_BUDGET_BYTES} B budget`);
    return total <= WEB_JS_BUDGET_BYTES
      ? pass(notes)
      : fail(
          [`marketing JS is ${total} B gzipped, over the ${WEB_JS_BUDGET_BYTES} B budget`],
          notes,
        );
  },
};
