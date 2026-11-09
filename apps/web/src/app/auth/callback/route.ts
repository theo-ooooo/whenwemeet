// API 가 넘긴 JWT 를 httpOnly 쿠키로 저장하고 next 로 이동 (인증흐름.md 2-5, 2-6)
import { NextRequest, NextResponse } from "next/server";
import { looksLikeJwt, safeNext, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  const headers = { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };

  if (!looksLikeJwt(token)) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("error", "OAUTH_STATE");
    return NextResponse.redirect(url, { status: 302, headers });
  }

  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), { status: 302, headers });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
