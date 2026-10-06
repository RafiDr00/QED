import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createHash } from "node:crypto";
import { geometryOf, pathDataOf } from "../logo-geometry.ts";
import { fail, pass, rel, root, walkIncludingDist, type Gate } from "./kit.ts";

// ============================================================ G4 logo fidelity

interface LogoBaseline {
  source: string;
  files: Record<
    string,
    {
      artifactSha256: string;
      pathDataSha256: string;
      geometrySha256: string;
      paths: string[];
      geometry: string[];
    }
  >;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export const gate: Gate = {
  id: "G4",
  title: "Logo fidelity - shipped path data identical to the design system",
  run() {
    const baselineFile = join(root, "design-system/logo-paths.json");
    if (!existsSync(baselineFile)) {
      return fail(["design-system/logo-paths.json missing - run scripts/snapshot-logos.ts"]);
    }
    const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as LogoBaseline;
    const failures: string[] = [];
    const notes: string[] = [];

    for (const [name, entry] of Object.entries(baseline.files)) {
      const src = join(root, "packages/ui/src/assets/logos", name);
      if (!existsSync(src)) {
        failures.push(`${name}: missing from packages/ui/src/assets/logos`);
        continue;
      }
      const raw = readFileSync(src);
      const fileHash = createHash("sha256").update(raw).digest("hex");
      if (fileHash !== entry.artifactSha256) {
        failures.push(
          `${name}: file bytes differ from the design system (${fileHash.slice(0, 12)} != ${entry.artifactSha256.slice(0, 12)})`,
        );
      }
      const text = raw.toString("utf8");
      const paths = pathDataOf(text);
      if (sha256(paths.join("|")) !== entry.pathDataSha256) {
        failures.push(`${name}: path 'd' data drifted`);
      }
      // Rects and the viewBox too: the wordmark's stems are rects.
      if (sha256(geometryOf(text).join("|")) !== entry.geometrySha256) {
        failures.push(`${name}: the drawing's geometry drifted (viewBox or a rect)`);
      }
    }

    // The generated module the components actually render from.
    const generated = join(root, "packages/ui/src/generated/logos.ts");
    if (!existsSync(generated)) {
      failures.push("packages/ui/src/generated/logos.ts missing - run the logo generator");
    } else {
      const text = readFileSync(generated, "utf8");
      for (const [name, entry] of Object.entries(baseline.files)) {
        for (const d of entry.paths) {
          if (!text.includes(d)) {
            failures.push(`generated/logos.ts: path from ${name} is missing or altered`);
            break;
          }
        }
      }
    }

    // And the shipped bundles.
    const shipped = [
      ...walkIncludingDist(join(root, "apps/web/dist"), (p) =>
        [".html", ".js", ".svg"].includes(extname(p)),
      ),
      ...walkIncludingDist(join(root, "apps/console/dist"), (p) =>
        [".html", ".js", ".svg"].includes(extname(p)),
      ),
    ];
    if (shipped.length === 0) {
      failures.push("no built app output to check the shipped logo against");
    } else {
      const known = new Set(
        Object.values(baseline.files).flatMap((entry) => entry.paths),
      );

      // 1. The prerendered HTML carries real <svg class="qed-logo"> blocks.
      //    Every path inside one must be a design-system path - no prefix
      //    filter, because a filter that only looks at paths which already
      //    start like the real thing cannot see a redrawn mark.
      let inspectedBlocks = 0;
      let inspectedPaths = 0;
      for (const file of shipped.filter((f) => extname(f) === ".html")) {
        const text = readFileSync(file, "utf8");
        for (const block of text.matchAll(
          /<svg[^>]*class="[^"]*qed-logo[^"]*"[\s\S]*?<\/svg>/g,
        )) {
          inspectedBlocks++;
          for (const m of block[0].matchAll(/\sd="([^"]+)"/g)) {
            const d = m[1];
            if (d === undefined) continue;
            inspectedPaths++;
            if (!known.has(d)) {
              failures.push(
                `${rel(file)}: a path inside a .qed-logo svg is not in the design system - "${d.slice(0, 48)}..."`,
              );
            }
          }
        }
      }

      // 2. The bundles hold the paths as string literals rather than markup.
      //    If a bundle contains the start of a logo path it must contain all
      //    of it, so a truncated or edited path cannot slip through.
      let bundlesWithLogos = 0;
      for (const file of shipped.filter((f) => extname(f) === ".js")) {
        const text = readFileSync(file, "utf8");
        let holdsLogo = false;
        for (const [name, entry] of Object.entries(baseline.files)) {
          for (const d of entry.paths) {
            const head = d.slice(0, 24);
            if (!text.includes(head)) continue;
            holdsLogo = true;
            if (!text.includes(d)) {
              failures.push(
                `${rel(file)}: a path from ${name} starts correctly but does not match - it was edited`,
              );
            }
          }
        }
        if (holdsLogo) bundlesWithLogos++;
      }

      if (inspectedBlocks === 0 && bundlesWithLogos === 0) {
        failures.push("no logo path data found in the shipped output at all");
      } else {
        notes.push(
          `${inspectedPaths} paths in ${inspectedBlocks} shipped .qed-logo blocks, ` +
            `${bundlesWithLogos} bundle(s) carrying logo paths, all verbatim`,
        );
      }
    }

    notes.push(`${Object.keys(baseline.files).length} logo files hashed against ${baseline.source}`);
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};
