// 웹 애플 로그인 시작 (docs/설계/앱.md 3.4, D-52). 카카오(/auth/kakao)와 같은 302 한 겹.
// 애플 버튼은 APPLE_LOGIN_ENABLED=1 일 때만 보이지만, 이 라우트를 직접 열면 API 가 미설정이면 503 을 준다
import { NextRequest, NextResponse } from "next/server";
import { safeNext } from "@/lib/auth";
import { apiUrl, isMock } from "@/lib/upstream";

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  if (isMock()) {
    const url = new URL("/auth/callback", req.nextUrl.origin);
    url.searchParams.set("token", "mock.me.sig");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, 302);
  }

  const target = new URL(`${apiUrl()}/v1/auth/apple`);
  target.searchParams.set("next", next);
  return NextResponse.redirect(target, 302);
}
