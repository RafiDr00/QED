import { useId } from "react";
import { formatCount, type DivergenceSample, type SampleValue } from "@qed/ui";

/**
 * Where a change bites, drawn. DECISIONS.md D-068.
 *
 * The inputs the engine classified around a divergence, placed along the one
 * or two fields its description names. A filled mark is an input on which the
 * two versions disagreed; a hollow one is an input on which they agreed. The
 * shape carries the state and the colour repeats it, which is the design
 * system's first rule: glyph first, colour second.
 *
 * A number axis is symmetric-log: generated inputs run from single digits to a
 * million, and a boundary at 100 would otherwise be a hair's width from zero.
 * A text or boolean field gets one row per value.
 */

const WIDTH = 920;
const PLOT_LEFT = 128;
const PLOT_RIGHT = WIDTH - 24;
const ROW = 40;
/** Room above the plot for the y axis name and the threshold labels. */
const TOP = 32;
const AXIS = 32;
const MARK = 4;
/** The fewest units between two tick labels. */
const TICK_GAP = 56;

const symlog = (v: number) => Math.sign(v) * Math.log10(1 + Math.abs(v));

type Axis =
  | { readonly kind: "number"; readonly min: number; readonly max: number }
  | { readonly kind: "category"; readonly values: readonly string[] };

const label = (v: SampleValue) => (typeof v === "string" ? JSON.stringify(v) : String(v));

function axisOf(values: readonly SampleValue[]): Axis {
  if (values.length > 0 && values.every((v) => typeof v === "number")) {
    const scaled = (values as number[]).map(symlog);
    const min = Math.min(...scaled);
    const max = Math.max(...scaled);
    if (min === max) return { kind: "number", min: min - 1, max: max + 1 };
    const pad = (max - min) * 0.04;
    return { kind: "number", min: min - pad, max: max + pad };
  }
  return { kind: "category", values: [...new Set(values.map(label))].sort() };
}

/**
 * Ticks at 0, at the thresholds the description names, and at powers of
 * ten - in that order of priority, keeping each only where its label has
 * room. A tick per power of ten put eleven labels on top of each other.
 */
function ticksOf(
  axis: Extract<Axis, { kind: "number" }>,
  place: (v: number) => number,
  preferred: readonly number[],
): number[] {
  const candidates = [0, ...preferred];
  for (let k = 1; k <= 16; k++) candidates.push(10 ** k, -(10 ** k));
  const kept: number[] = [];
  for (const v of candidates) {
    const s = symlog(v);
    if (s < axis.min || s > axis.max || kept.includes(v)) continue;
    if (kept.some((k) => Math.abs(place(k) - place(v)) < TICK_GAP)) continue;
    kept.push(v);
  }
  return kept.sort((a, b) => a - b);
}

const tickLabel = (v: number) => {
  const a = Math.abs(v);
  return a >= 1000 && Number.isInteger(Math.log10(a)) ? `${v < 0 ? "-" : ""}1e${Math.log10(a)}` : String(v);
};

/** A small, stable offset per point, so equal inputs do not hide each other. */
const jitter = (i: number, spread: number) => (((i * 2654435761) % 1000) / 1000 - 0.5) * spread;

export function DivergenceMap({ symbol, sample }: { symbol: string; sample: DivergenceSample }) {
  const id = useId();
  const xAxis = axisOf(sample.points.map(([x]) => x));
  const yAxis = sample.y === undefined ? undefined : axisOf(sample.points.map(([, y]) => y));

  const rows = yAxis === undefined ? 1 : yAxis.kind === "category" ? yAxis.values.length : 6;
  const plotHeight = rows * ROW;
  const height = TOP + plotHeight + AXIS;

  const xOf = (v: SampleValue): number => {
    if (xAxis.kind === "number") {
      return PLOT_LEFT + ((symlog(v as number) - xAxis.min) / (xAxis.max - xAxis.min)) * (PLOT_RIGHT - PLOT_LEFT);
    }
    const band = (PLOT_RIGHT - PLOT_LEFT) / xAxis.values.length;
    return PLOT_LEFT + band * (xAxis.values.indexOf(label(v)) + 0.5);
  };
  const yOf = (v: SampleValue, i: number): number => {
    if (yAxis === undefined) return TOP + ROW / 2 + jitter(i, ROW * 0.6);
    if (yAxis.kind === "category") {
      return TOP + ROW * (yAxis.values.indexOf(label(v)) + 0.5) + jitter(i, ROW * 0.5);
    }
    return TOP + plotHeight - ((symlog(v as number) - yAxis.min) / (yAxis.max - yAxis.min)) * plotHeight;
  };

  const diverged = sample.points.filter(([, , d]) => d === 1).length;
  const summary =
    `${formatCount(sample.points.length)} classified inputs for ${symbol}, along ${sample.x}` +
    (sample.y !== undefined ? ` and ${sample.y}` : "") +
    `: ${formatCount(diverged)} diverged, ${formatCount(sample.points.length - diverged)} agreed.`;

  return (
    <figure className="con-map" aria-labelledby={`${id}-caption`}>
      <figcaption id={`${id}-caption`} className="t-body-sm qed-prose con-note">
        {summary}
        {sample.omitted !== undefined && sample.omitted > 0
          ? ` ${formatCount(sample.omitted)} more had values JSON cannot carry, and are not drawn.`
          : ""}
      </figcaption>

      <ul className="con-map-legend t-body-sm" aria-label="Legend">
        <li>
          <svg viewBox="0 0 12 12" className="con-map-key" aria-hidden="true">
            <circle cx="6" cy="6" r="4" className="con-map-diverged" />
          </svg>
          the two versions disagree
        </li>
        <li>
          <svg viewBox="0 0 12 12" className="con-map-key" aria-hidden="true">
            <circle cx="6" cy="6" r="4" className="con-map-agreed" />
          </svg>
          they agree
        </li>
      </ul>

      <svg
        className="con-map-plot"
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={summary}
      >
        {/* Axes and gridlines: recessive, so the marks are what is read. */}
        <line className="con-map-axis" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={TOP + plotHeight} y2={TOP + plotHeight} />
        {xAxis.kind === "number"
          ? ticksOf(xAxis, xOf, (sample.rules ?? []).filter((r) => r.axis === "x").map((r) => r.value)).map((v) => (
              <g key={`x${v}`}>
                <line className="con-map-grid" x1={xOf(v)} x2={xOf(v)} y1={TOP} y2={TOP + plotHeight} />
                <text className="con-map-tick" x={xOf(v)} y={TOP + plotHeight + 20} textAnchor="middle">
                  {tickLabel(v)}
                </text>
              </g>
            ))
          : xAxis.values.map((v) => (
              <text key={`x${v}`} className="con-map-tick" x={xOf(JSON.parse(v) as SampleValue)} y={TOP + plotHeight + 20} textAnchor="middle">
                {v}
              </text>
            ))}
        <text className="con-map-name" x={PLOT_RIGHT} y={TOP + plotHeight + 20} textAnchor="end" dy="0" aria-hidden="true">
          {sample.x}
        </text>

        {yAxis?.kind === "category"
          ? yAxis.values.map((v, i) => (
              <text key={`y${v}`} className="con-map-tick" x={PLOT_LEFT - 12} y={TOP + ROW * (i + 0.5)} textAnchor="end" dominantBaseline="middle">
                {v}
              </text>
            ))
          : null}
        {sample.y !== undefined ? (
          <text className="con-map-name" x={PLOT_LEFT - 12} y={TOP - 12} textAnchor="end">
            {sample.y}
          </text>
        ) : null}

        {/* Thresholds the description names, where it says the change starts. */}
        {(sample.rules ?? []).map((rule) =>
          rule.axis === "x" ? (
            <g key={`r${rule.axis}${rule.value}`}>
              <line className="con-map-rule" x1={xOf(rule.value)} x2={xOf(rule.value)} y1={TOP} y2={TOP + plotHeight} />
              <text className="con-map-name" x={xOf(rule.value)} y={TOP - 12} textAnchor="middle">
                {rule.operator === "is at least" ? "≥" : ">"} {rule.value}
              </text>
            </g>
          ) : null,
        )}

        {/* Agreeing inputs underneath, so a divergence is never hidden by one. */}
        {[0, 1].map((layer) =>
          sample.points.map(([x, y, d], i) =>
            d === layer ? (
              <circle
                key={`p${i}`}
                cx={xOf(x)}
                cy={yOf(y, i)}
                r={MARK}
                className={d === 1 ? "con-map-diverged" : "con-map-agreed"}
              >
                <title>
                  {`${sample.x} ${label(x)}${sample.y !== undefined ? ` · ${sample.y} ${label(y)}` : ""} · ${d === 1 ? "diverges" : "agrees"}`}
                </title>
              </circle>
            ) : null,
          ),
        )}
      </svg>

      <details className="con-map-table">
        <summary className="t-body-sm">The same inputs as a table</summary>
        <div className="qed-table-scroll" tabIndex={0} role="group" aria-label={`Classified inputs for ${symbol}`}>
          <table className="qed-table">
            <thead>
              <tr>
                <th scope="col">{sample.x}</th>
                {sample.y !== undefined ? <th scope="col">{sample.y}</th> : null}
                <th scope="col">VERSIONS</th>
              </tr>
            </thead>
            <tbody>
              {sample.points.map(([x, y, d], i) => (
                <tr key={i}>
                  <td className="t-mono-sm">{label(x)}</td>
                  {sample.y !== undefined ? <td className="t-mono-sm">{label(y)}</td> : null}
                  <td className="t-mono-sm">{d === 1 ? "disagree" : "agree"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
