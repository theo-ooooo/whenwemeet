// API 가 넘긴 JWT 를 httpOnly 쿠키로 저장하고 next 로 이동 (인증흐름.md 2-5, 2-6)
import { NextRequest, NextResponse } from "next/server";
import {
  decodeNextFromApi,
  JOIN_AUTO_COOKIE,
  JOIN_AUTO_MAX_AGE,
  joinCodeOf,
  looksLikeJwt,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  // /auth/kakao 가 쿼리를 경로 모양으로 바꿔 보냈다. 원래 경로(+쿼리)로 되돌린다 (#65)
  const next = decodeNextFromApi(req.nextUrl.searchParams.get("next"));

  const headers = { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };

  if (!looksLikeJwt(token)) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("error", "OAUTH_STATE");
    return NextResponse.redirect(url, { status: 302, headers });
  }

  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), { status: 302, headers });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  // 초대 링크에서 로그인했다면 /join/<code> 가 "합류하기" 없이 바로 합류하도록 표시한다 (기획 MVP: 링크 열면 로그인 후 자동 합류).
  // 링크를 그냥 연 로그인 사용자에게는 이 쿠키가 없어 확인 화면이 그대로 나온다
  const joinCode = joinCodeOf(next);
  if (joinCode) {
    res.cookies.set(JOIN_AUTO_COOKIE, joinCode, {
      path: "/",
      maxAge: JOIN_AUTO_MAX_AGE,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}
