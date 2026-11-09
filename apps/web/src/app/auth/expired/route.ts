// 세션 만료 처리: wwm_session, wwm_group 를 지우고 /login?next=...&reason=expired 로 303 (#37).
// 서버 컴포넌트(쿠키를 지울 수 없음)와 브라우저(lib/api.ts, httpOnly 라 못 지움)가 401 을 받으면 여기로 보낸다.
import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies, loginExpiredUrl } from "@/lib/session";

export async function GET(req: NextRequest) {
  const url = loginExpiredUrl(req.nextUrl.origin, req.nextUrl.searchParams.get("next"));
  const res = NextResponse.redirect(url, {
    status: 303,
    headers: { "Cache-Control": "no-store" },
  });
  return clearSessionCookies(res);
}
