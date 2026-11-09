// Next 16 proxy (middleware 후속). 보호 라우트에 세션 쿠키가 없으면 /login?next= 로.
// 쿠키의 존재만 본다. 유효성은 첫 API 호출의 401 로 드러난다 (인증흐름.md 3)
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export function proxy(req: NextRequest) {
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/g/:path*", "/groups/:path*", "/me"],
};
