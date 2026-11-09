// 로그인 시작. API 주소를 브라우저에 노출하지 않기 위한 한 겹 (인증흐름.md 2-1, 결정기록 D-09)
import { NextRequest, NextResponse } from "next/server";
import { safeNext } from "@/lib/auth";
import { apiUrl, isMock } from "@/lib/upstream";

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  if (isMock()) {
    // 목 모드: 카카오 없이 바로 콜백으로 (토큰은 'mock.me.sig' 형태)
    const url = new URL("/auth/callback", req.nextUrl.origin);
    url.searchParams.set("token", "mock.me.sig");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, 302);
  }

  const target = new URL(`${apiUrl()}/v1/auth/kakao`);
  target.searchParams.set("next", next);
  return NextResponse.redirect(target, 302);
}
