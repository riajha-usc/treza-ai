/** Weekly cash balance with the reserve floor drawn as a dashed line. */
export function Sparkline({ values, floor, breachWeek }: { values: number[]; floor: number; breachWeek: number | null }) {
  const w = 220;
  const h = 48;
  const all = [...values, floor];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full max-w-[220px]" role="img" aria-label="Weekly cash projection">
      <line x1="0" x2={w} y1={y(floor)} y2={y(floor)} stroke="var(--warn)" strokeDasharray="3 3" strokeWidth="1" />
      <path d={path} fill="none" stroke={breachWeek ? "var(--bad)" : "var(--good)"} strokeWidth="1.75" />
      {breachWeek ? <circle cx={x(breachWeek - 1)} cy={y(values[breachWeek - 1])} r="3" fill="var(--bad)" /> : null}
    </svg>
  );
}
