import type { ReactNode } from "react";

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-sm font-medium tracking-wide text-text">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const TONES = {
  good: "text-good border-good/40",
  warn: "text-warn border-warn/40",
  bad: "text-bad border-bad/40",
  neutral: "text-muted border-line",
  accent: "text-accent-text border-accent-line/60 bg-accent",
} as const;

export function Chip({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-xs ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}
