import { Suspense } from "react";
import { TrezaMark } from "./treza-mark";
import { connection } from "next/server";
import { currentActor } from "@/lib/actor";
import { loadShell } from "@/lib/queries/shell";
import { ActiveNav } from "./active-nav";
import { NavList } from "./nav-list";
import { SidebarToggle } from "./sidebar-toggle";

export function Sidebar() {
  return (
    <aside className="sticky top-0 z-20 h-screen w-[232px] flex-none border-r border-line bg-surface transition-[width] duration-200 collapsed:w-[76px]">
      <div className="flex h-full flex-col gap-5 overflow-y-auto overflow-x-hidden px-3 py-4 collapsed:gap-2.5 collapsed:px-1.5 collapsed:py-3">
        <div className="flex items-center gap-2 px-2 py-0.5 text-[15px] font-semibold tracking-[-0.01em] collapsed:justify-center collapsed:px-0 collapsed:pb-1.5">
          <TrezaMark className="size-5 shrink-0 text-primary" />
          <span className="collapsed:hidden">Treza</span>
        </div>
        <div className="flex flex-col gap-px rounded-md border border-line px-2.5 py-2 collapsed:hidden">
          <span className="text-2xs text-muted">Platform</span>
          <Suspense fallback={<span className="font-medium">&nbsp;</span>}>
            <PlatformName />
          </Suspense>
        </div>
        <Suspense fallback={<NavList path={null} pending={0} />}>
          <Nav />
        </Suspense>
        <div className="mt-auto flex flex-col gap-0.5 border-t border-line px-2 pt-3 collapsed:hidden">
          <Suspense fallback={<span className="font-medium">&nbsp;</span>}>
            <Whoami />
          </Suspense>
        </div>
      </div>
      <SidebarToggle />
    </aside>
  );
}

async function PlatformName() {
  await connection();
  return <b className="font-medium">{(await loadShell()).platformName}</b>;
}

async function Nav() {
  await connection();
  return <ActiveNav pending={(await loadShell()).pendingApprovals} />;
}

async function Whoami() {
  const actor = await currentActor();
  return (
    <>
      <span className="font-medium">{actor.name}</span>
      <span className="text-muted">{actor.role}</span>
    </>
  );
}
