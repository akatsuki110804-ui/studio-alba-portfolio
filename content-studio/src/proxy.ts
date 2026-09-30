import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only (cookie presence). Real session validation happens
// server-side in layouts, actions and route handlers.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("cs_session")) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/projects/:path*"],
};
