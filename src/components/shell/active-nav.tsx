"use client";

import { usePathname } from "next/navigation";
import { NavList } from "./nav-list";

export function ActiveNav({ pending }: { pending: number }) {
  return <NavList path={usePathname()} pending={pending} />;
}
