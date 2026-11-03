import { format } from "@/lib/money/money";

const W = 720;
const H = 180;
const PAD = { l: 52, r: 8, t: 12, b: 24 };

type Series = { label: string; values: number[]; tone: "primary" | "bad"; breachWeek: number | null };

/** Projected weekly cash for each option, with the reserve floor as a dashed line. Values in minor units. */
export function CashChart({ series, floorMinor, currency }: { series: Series[]; floorMinor: number; currency: string }) {
  const all = [...series.flatMap((s) => s.values), floorMinor];
  const step = niceStep((Math.max(...all) - Math.min(0, ...all)) / 4);
  const lo = Math.floor(Math.min(...all) / step) * step;
  const hi = Math.ceil(Math.max(...all) / step) * step;
  const weeks = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => PAD.l + (i / Math.max(1, weeks - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const stroke = { primary: "var(--primary)", bad: "var(--bad)" };
  const label = series.map((s) => `${s.label}${s.breachWeek ? ` falls below the floor in week ${s.breachWeek}` : " stays above the floor"}`).join(". ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Projected weekly cash. ${label}.`} className="block h-auto w-full text-2xs">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fill="var(--muted)">
              {t >= 100_000 ? `$${t / 100_000}k` : `$${Math.round(t / 100)}`}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(floorMinor)} y2={y(floorMinor)} stroke="var(--warn)" strokeDasharray="4 3" />
        {series.map((s) => (
          <g key={s.label}>
            <polyline points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke={stroke[s.tone]} strokeWidth="1.75" strokeLinejoin="round" />
            {s.breachWeek ? <circle cx={x(s.breachWeek - 1)} cy={y(s.values[s.breachWeek - 1])} r="3.5" fill={stroke[s.tone]} /> : null}
          </g>
        ))}
        {[0, Math.floor((weeks - 1) / 2), weeks - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === weeks - 1 ? "end" : "middle"} fill="var(--muted)">
            Week {i + 1}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-5 text-xs text-ink-2">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: stroke[s.tone] }} />
            {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-warn">
          <span aria-hidden className="inline-block w-3 border-t border-dashed border-warn" />
          Reserve floor {format(floorMinor, currency)}
        </span>
      </div>
    </div>
  );
}

/** 1, 2 or 5 times a power of ten, at least the raw step. */
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}
