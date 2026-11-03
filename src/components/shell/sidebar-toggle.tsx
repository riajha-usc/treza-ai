"use client";

import { SIDEBAR_KEY } from "./sidebar-key";

/** Collapses the sidebar to its icon strip. The choice is kept in localStorage. */
export function SidebarToggle() {
  function toggle() {
    const root = document.documentElement;
    const collapsed = root.dataset.sidebar !== "collapsed";
    if (collapsed) root.dataset.sidebar = "collapsed";
    else delete root.dataset.sidebar;
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
    } catch {}
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Collapse or expand the sidebar"
      title="Collapse or expand the sidebar"
      className="absolute top-3.5 -right-3 z-30 flex size-6 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 shadow-[0_1px_2px_rgba(20,24,31,0.08)] hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <svg viewBox="0 0 16 16" aria-hidden className="size-3 fill-none stroke-current stroke-[1.8] transition-transform collapsed:rotate-180" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
    </button>
  );
}
