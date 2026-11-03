import Link from "next/link";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/purchases", label: "Purchases" },
  { href: "/disputes", label: "Disputes" },
  { href: "/sellers", label: "Sellers" },
];

export function Nav() {
  return (
    <nav className="border-b border-line bg-panel/60">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
        <Link href="/" className="font-mono text-xs uppercase tracking-[0.2em] text-text">
          Treza AI
        </Link>
        <div className="flex gap-4 text-sm">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted hover:text-text">
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
