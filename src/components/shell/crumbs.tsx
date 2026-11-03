"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav-list";

const LABELS = new Map(NAV.flatMap((g) => g.items.map((i) => [i.href, i.label])));

/** "Purchases / 3f2a9c1b" from the current path. */
export function Crumbs() {
  const [section, id] = usePathname().split("/").filter(Boolean);
  const href = `/${section ?? ""}`;
  const label = LABELS.get(href) ?? "Overview";
  if (!id) return <b className="font-medium text-ink">{label}</b>;
  return (
    <span>
      <Link href={href} className="hover:text-ink">
        {label}
      </Link>
      {" / "}
      <b className="font-mono text-xs font-medium text-ink">{decodeURIComponent(id).slice(0, 8)}</b>
    </span>
  );
}
