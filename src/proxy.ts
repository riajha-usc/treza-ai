import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, decideAccess } from "@/lib/access";

/** Access link for the hosted demo. See src/lib/access.ts. */
export function proxy(request: NextRequest) {
  const key = process.env.DEMO_ACCESS_KEY;
  const a = decideAccess({ key, pathname: request.nextUrl.pathname, search: request.nextUrl.searchParams, cookie: request.cookies.get(ACCESS_COOKIE)?.value });
  if (a.kind === "open" || a.kind === "allow") return NextResponse.next();
  if (a.kind === "grant") {
    const res = NextResponse.redirect(new URL(a.redirectTo, request.url));
    const https = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")) === "https";
    res.cookies.set(ACCESS_COOKIE, key!, { httpOnly: true, sameSite: "lax", secure: https, path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  }
  return new NextResponse("This Treza demo opens with an access link. Ask the team for one.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
