import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic route guard: redirect unauthenticated users to /login before they
 * reach protected pages. Real role/scope checks happen server-side in the pages
 * and API routes — this is just for UX (fast redirect on missing session).
 */
export function middleware(req: NextRequest) {
  const session = getSessionCookie(req);
  if (!session) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Protect the app pages; exclude /login, /api/auth, and static assets.
  matcher: ["/", "/upload", "/dashboard/:path*"],
};
