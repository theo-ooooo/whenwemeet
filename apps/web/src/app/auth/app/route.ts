// 앱 셸 로그인 마무리 (docs/설계/앱.md 2.3). 셸이 네이티브 로그인으로 받은 60초 handoff 와 verifier 를
// 서버에서 API 로 넘겨 세션 JWT 로 바꾸고, 카카오 웹 콜백과 같은 httpOnly 쿠키로 싣는다. JWT 는 URL 과 셸에 실리지 않는다.
import { NextRequest, NextResponse } from "next/server";
import { GROUP_COOKIE, isHandoffPair, looksLikeJwt, safeNext, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { readEnvelope } from "@/lib/envelope";
import { isMock, upstream } from "@/lib/upstream";

const HEADERS = { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };

function toLogin(req: NextRequest, error: string, next: string): NextResponse {
  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("error", error);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, { status: 302, headers: HEADERS });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const h = sp.get("h");
  const v = sp.get("v");
  const next = safeNext(sp.get("next"));

  if (!isHandoffPair(h, v)) return toLogin(req, "HANDOFF_INVALID", next);

  let token: string | null = null;
  if (isMock()) {
    // 목 모드: API 없이 기본 사용자로 (카카오 목 로그인과 같은 토큰)
    token = "mock.me.sig";
  } else {
    const r = await upstream({
      method: "POST",
      path: "/auth/handoff",
      body: JSON.stringify({ handoff: h, verifier: v }),
      token: null,
    });
    const env = readEnvelope<{ token?: unknown }>(r.status, r.body);
    if (env.ok && typeof env.data?.token === "string") token = env.data.token;
    // 401(없음, 만료, 사용됨, verifier 불일치)과 400(형식)은 다시 로그인. 그 밖(연결 실패, 5xx)은 일반 실패 문구
    else if (r.status === 400 || r.status === 401) return toLogin(req, "HANDOFF_INVALID", next);
    else return toLogin(req, "LOGIN_FAILED", next);
  }

  if (!looksLikeJwt(token)) return toLogin(req, "LOGIN_FAILED", next);

  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin), { status: 302, headers: HEADERS });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  // 다른 계정으로 들어왔을 수 있으니 이전 팀 기억은 지운다 (2.3)
  res.cookies.set(GROUP_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return res;
}
