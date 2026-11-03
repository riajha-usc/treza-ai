import type { ReactNode } from "react";

export function PageHeader({ title, status, subtitle, actions }: { title: ReactNode; status?: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-2.5 text-title font-semibold tracking-[-0.01em]">
          {title}
          {status}
        </h1>
        {subtitle ? <p className="mt-0.5 text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** A bordered section. The body has no padding so tables sit flush; wrap prose in PanelBody. */
export function Panel({ title, meta, children, className = "" }: { title: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-lg border border-line bg-surface ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-section font-semibold">{title}</h2>
        {meta ? <div className="flex items-center gap-2 text-muted">{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function PanelBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-3.5 ${className}`}>{children}</div>;
}

export function PanelNote({ children }: { children: ReactNode }) {
  return <div className="border-t border-line px-4 py-2.5 text-xs text-muted">{children}</div>;
}

const TONES = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-primary-soft text-primary",
  neutral: "bg-subtle text-ink-2 ring-1 ring-inset ring-line",
} as const;
export type Tone = keyof typeof TONES;

export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded px-1.5 text-xs font-medium ${TONES[tone]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

const ACTOR_LABEL = { rules: "RULES", model: "MODEL", human: "PERSON", system: "SYSTEM" } as const;

/** Who made a decision: code rules, a Claude model, a person or the system. */
export function Actor({ actor }: { actor: keyof typeof ACTOR_LABEL }) {
  return <span className="rounded-[3px] border border-line-strong px-1.5 font-mono text-2xs tracking-wide text-ink-2">{ACTOR_LABEL[actor]}</span>;
}

export function Figures({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <section aria-label="Key figures" className="grid overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      {items.map((f) => (
        <div key={f.label} className="flex flex-col gap-0.5 border-line px-4 py-3.5 not-first:border-t sm:not-first:border-t-0 sm:not-first:border-l">
          <span className="text-muted">{f.label}</span>
          <span className="text-figure font-medium tracking-[-0.01em] tabular-nums">{f.value}</span>
          {f.note ? <span className="text-muted">{f.note}</span> : null}
        </div>
      ))}
    </section>
  );
}

/** Label and value pairs, values right-aligned. */
export function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 px-4 py-3.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Bar({ pct, tone = "info" }: { pct: number; tone?: "info" | "warn" | "bad" | "good" }) {
  const fill = { info: "bg-primary", warn: "bg-warn", bad: "bg-bad", good: "bg-good" }[tone];
  return (
    <div className="h-1.5 overflow-hidden rounded-[3px] bg-subtle ring-1 ring-inset ring-line">
      <i className={`block h-full ${fill}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-muted">{children}</p>;
}
