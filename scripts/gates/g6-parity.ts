import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { round2 } from "../color.ts";
import { compareBitmaps, decodePng, lumaStats } from "../png.ts";
import { fail, pass, readEvidence, root, themeIds, type Gate } from "./kit.ts";

// ============================================================= G6 theme parity

interface ShotEvidence {
  shots: { name: string; theme: string; file: string }[];
}

export const gate: Gate = {
  id: "G6",
  title: "Theme parity - every component shot in both themes, neither blank",
  run() {
    const evidence = readEvidence("screenshots.json") as ShotEvidence | null;
    if (!evidence) return fail(["no .verify/screenshots.json from the e2e run"]);
    const failures: string[] = [];
    const notes: string[] = [];

    const byName = new Map<string, Map<string, string>>();
    for (const shot of evidence.shots) {
      const entry = byName.get(shot.name) ?? new Map<string, string>();
      entry.set(shot.theme, shot.file);
      byName.set(shot.name, entry);
    }
    if (byName.size === 0) failures.push("no screenshots recorded");

    for (const [name, themes] of byName) {
      for (const theme of themeIds) {
        if (!themes.has(theme)) failures.push(`${name}: no ${theme} screenshot`);
      }
      const files = themeIds.map((t) => themes.get(t));
      const bitmaps = files.map((f) => {
        if (!f) return null;
        const full = join(root, f);
        if (!existsSync(full)) return null;
        return decodePng(readFileSync(full));
      });

      bitmaps.forEach((bitmap, i) => {
        const theme = themeIds[i];
        if (!bitmap) {
          failures.push(`${name} (${theme}): screenshot file missing`);
          return;
        }
        const stats = lumaStats(bitmap);
        if (stats.stdDev < 2 || stats.distinctValues < 5) {
          failures.push(
            `${name} (${theme}): screenshot looks blank (sd ${round2(stats.stdDev)}, ${stats.distinctValues} luma values)`,
          );
        }
      });

      const [a, b] = bitmaps;
      if (a && b) {
        const diff = compareBitmaps(a, b);
        // Both themes share every metric, so a size difference means the
        // shot caught the component mid-layout - not a theme difference.
        if (!diff.dimensionsMatch) {
          failures.push(
            `${name}: the two theme shots are different sizes (${a.width}x${a.height} vs ${b.width}x${b.height}) - the comparison would prove nothing`,
          );
        } else if (
          // Void is the dark theme and Paper the light one; a palette that
          // merely differed would pass the ratio check on its own.
          lumaStats(a).mean >= lumaStats(b).mean
        ) {
          failures.push(
            `${name}: the void shot is not darker than the paper one ` +
              `(${round2(lumaStats(a).mean)} vs ${round2(lumaStats(b).mean)}) - the themes are not what they say`,
          );
        } else if (diff.ratio < 0.1) {
          failures.push(
            `${name}: void and paper differ on only ${round2(diff.ratio * 100)}% of pixels - the theme is not switching`,
          );
        } else {
          notes.push(
            `${name}: themes differ on ${round2(diff.ratio * 100)}% of pixels`,
          );
        }
      }
    }

    notes.unshift(`${byName.size} components x ${themeIds.length} themes`);
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};
