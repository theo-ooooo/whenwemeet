// 로그아웃: 쿠키를 지운다 (JWT 는 무상태).
// (#188 D-83) 폼에 이 기기 푸시 토큰(pushToken)이 있으면 쿠키를 지우기 전에 그 세션으로 서버에서 기기를 해제한다.
// 2초 제한, 실패해도 로그아웃은 그대로 진행한다 (푸시-알림.md 2-3)
import { NextRequest, NextResponse } from "next/server";
import { GROUP_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { PUSH_TOKEN_RE } from "@/lib/app-bridge";
import { upstream } from "@/lib/upstream";

const UNREGISTER_TIMEOUT_MS = 2_000;

/** 폼 본문의 pushToken. 없거나 형식이 틀리면 null */
async function pushTokenOf(req: NextRequest): Promise<string | null> {
  try {
    const type = req.headers.get("content-type") ?? "";
    if (!type.includes("application/x-www-form-urlencoded") && !type.includes("multipart/form-data")) return null;
    const v = (await req.formData()).get("pushToken");
    return typeof v === "string" && PUSH_TOKEN_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  const pushToken = await pushTokenOf(req);
  if (session && pushToken) {
    try {
      await upstream({
        method: "DELETE",
        path: "/me/push-devices",
        body: JSON.stringify({ token: pushToken }),
        token: session,
        timeoutMs: UNREGISTER_TIMEOUT_MS,
      });
    } catch {
      // 기기 해제 실패는 로그아웃을 막지 않는다
    }
  }
  const res = NextResponse.redirect(new URL("/login", req.nextUrl.origin), { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  res.cookies.set(GROUP_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return res;
}
