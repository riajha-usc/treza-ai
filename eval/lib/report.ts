/** A measured section of the evaluation report. */
export interface Section {
  title: string;
  /** What was run and against what. */
  method: string;
  /** Headline numbers, one per line. */
  headline: string[];
  table: { headers: string[]; rows: (string | number)[][] };
  /** Cases worth reading about: misses, limits, label checks. */
  notes: string[];
}

export const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${n}/${d} (${Math.round((n / d) * 100)}%)`);

export const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

const cell = (v: string | number) => String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");

export function toMarkdown(s: Section): string {
  const out = [`## ${s.title}`, "", s.method, "", ...s.headline.map((h) => `- ${h}`), ""];
  out.push(`| ${s.table.headers.join(" | ")} |`, `|${s.table.headers.map(() => "---").join("|")}|`);
  for (const r of s.table.rows) out.push(`| ${r.map(cell).join(" | ")} |`);
  if (s.notes.length) out.push("", ...s.notes.map((n) => `- ${n}`));
  return out.join("\n");
}

export function print(s: Section) {
  console.log(`\n${s.title}`);
  for (const h of s.headline) console.log(`  ${h}`);
  for (const n of s.notes) console.log(`  note: ${n}`);
}
