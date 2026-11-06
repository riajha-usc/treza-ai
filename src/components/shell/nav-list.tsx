import Link from "next/link";
import type { ReactNode } from "react";

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-none stroke-current stroke-[1.4] collapsed:size-[18px]" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

type Item = { href: string; label: string; short: string; icon: ReactNode; count?: "approvals" };

export const NAV: { heading: string; items: Item[] }[] = [
  {
    heading: "Operations",
    items: [
      { href: "/", label: "Overview", short: "Overview", icon: icon(<><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></>) },
      { href: "/purchases", label: "Purchases", short: "Purchases", icon: icon(<><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" /><path d="M1.5 6.5h13M4 10h2.5" /></>) },
      { href: "/disputes", label: "Disputes", short: "Disputes", icon: icon(<path d="M8 1.5 13.5 3.5V8c0 3-2.5 5.4-5.5 6.5C5 13.4 2.5 11 2.5 8V3.5Z" />) },
      { href: "/sellers", label: "Sellers", short: "Sellers", icon: icon(<><path d="M2.5 6.5v7h11v-7M1.5 6.5 3 2.5h10l1.5 4Z" /><path d="M6.5 13.5v-4h3v4" /></>) },
    ],
  },
  {
    heading: "Controls",
    items: [
      { href: "/approvals", label: "Approvals", short: "Approvals", count: "approvals", icon: icon(<><circle cx="8" cy="8" r="6" /><path d="m5.5 8.2 1.7 1.6 3.3-3.5" /></>) },
      { href: "/policies", label: "Spend policies", short: "Policies", icon: icon(<><path d="M2 4.5h12M2 11.5h12" /><circle cx="5.5" cy="4.5" r="1.6" className="fill-surface" /><circle cx="10.5" cy="11.5" r="1.6" className="fill-surface" /></>) },
      { href: "/audit", label: "Audit log", short: "Audit", icon: icon(<><rect x="3" y="1.5" width="10" height="13" rx="1.5" /><path d="M5.5 5h5M5.5 8h5M5.5 11h3" /></>) },
    ],
  },
  {
    heading: "Ledger",
    items: [
      { href: "/journal", label: "Journal", short: "Journal", icon: icon(<path d="M2.5 3c2-1 4-1 5.5.2C9.5 2 11.5 2 13.5 3v10c-2-1-4-1-5.5.2C6.5 12 4.5 12 2.5 13ZM8 3.2v10" />) },
      { href: "/reconciliation", label: "Reconciliation", short: "Reconcile", icon: icon(<path d="M2.5 5.5h10m-2.2-2.2 2.2 2.2-2.2 2.2M13.5 10.5h-10m2.2-2.2-2.2 2.2 2.2 2.2" />) },
    ],
  },
];

export const isActive = (href: string, path: string | null) => (path === null ? false : href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

/** The sidebar links. Rendered without an active item while the pathname is unknown. */
export function NavList({ path, pending }: { path: string | null; pending: number }) {
  return (
    <div className="flex flex-col gap-5 collapsed:gap-2">
      {NAV.map((g) => (
        <nav key={g.heading} aria-label={g.heading} className="flex flex-col gap-px collapsed:not-first:border-t collapsed:not-first:border-line collapsed:not-first:pt-2">
          <div className="px-2 pb-1.5 text-2xs font-medium uppercase tracking-[0.06em] text-muted collapsed:hidden">{g.heading}</div>
          {g.items.map((it) => {
            const on = isActive(it.href, path);
            return (
              <Link
                key={it.href}
                href={it.href}
                title={it.label}
                aria-current={on ? "page" : undefined}
                data-on={on || undefined}
                className="group relative flex items-center gap-2.5 whitespace-nowrap rounded-[5px] px-2 py-1.5 text-ink-2 hover:bg-subtle data-on:bg-primary-soft data-on:font-medium data-on:text-primary collapsed:flex-col collapsed:justify-center collapsed:gap-1 collapsed:px-0.5 collapsed:py-2"
              >
                <span className="flex text-muted group-data-on:text-primary">{it.icon}</span>
                <span className="collapsed:hidden">{it.label}</span>
                <span className="hidden text-[10px] leading-tight collapsed:block">{it.short}</span>
                {it.count && pending > 0 ? (
                  <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad-soft px-1 text-2xs font-medium text-bad collapsed:absolute collapsed:top-[3px] collapsed:left-[42px] collapsed:ml-0 collapsed:h-3.5 collapsed:min-w-3.5 collapsed:text-[9px]">
                    {pending}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      ))}
    </div>
  );
}
