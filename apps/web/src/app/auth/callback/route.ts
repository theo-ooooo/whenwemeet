// API 가 넘긴 JWT 를 httpOnly 쿠키로 저장하고 착지 화면(/auth/landing?next=)으로 이동 (인증흐름.md 2-5, 2-6, #310).
// 웹 카카오, 웹 애플 로그인이 여기로 온다. next(/join/.., 옛 /g/..) 로 바로 302 하면 Android 브라우저가 그 리다이렉트를
// 설치된 앱(세션 없음)으로 넘겨 앱 로그인 화면에서 끝난다 (#307 과 같은 원인). 착지 화면이 next 로 클라이언트 이동한다
import { NextRequest, NextResponse } from "next/server";
import { dropLegacyQueryMark, landingPath, looksLikeJwt, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  // next 는 경로 + 쿼리 그대로 온다 (#71). 초대 자동 합류 의도도 쿠키가 아니라 next 의 `?auto=1` 로 실려 온다 (D-41)
  // landingPath 가 safeNext 로 다시 거른다
  const next = dropLegacyQueryMark(req.nextUrl.searchParams.get("next"));

  const headers = { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };

  if (!looksLikeJwt(token)) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("error", "OAUTH_STATE");
    return NextResponse.redirect(url, { status: 302, headers });
  }

  // (#310) next 가 아니라 착지 화면으로. 앱 셸 handoff(/auth/app)는 앱 웹뷰 안이라 next 로 바로 간다
  const res = NextResponse.redirect(new URL(landingPath(next), req.nextUrl.origin), { status: 302, headers });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
