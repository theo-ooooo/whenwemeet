// (#198) 웹 OAuth 로그인 방법 연결 착지 (D-257). API 콜백이 `/me/link?ticket=&next=` (실패면 `?error=&next=`) 로 보낸다.
// 이 기기의 세션으로 POST /me/auth-accounts { ticket } 을 불러 연결을 끝내고, 결과를 next(로그인 방법 화면)에 싣고 간다.
// 티켓은 5분 1회용이고 연결을 시작한 사용자에게 묶여 있어 다른 사람의 세션으로는 쓸 수 없다
import { type NextRequest, NextResponse } from "next/server";
import { linkReturnPath } from "@/lib/account-link";
import { SESSION_COOKIE } from "@/lib/auth";
import { clientIpOf } from "@/lib/email-login";
import { expiredUrl } from "@/lib/session";
import { upstream } from "@/lib/upstream";

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;
const TICKET = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^[A-Z_]{1,40}$/;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const next = sp.get("next");
  const go = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin), { status: 303, headers: HEADERS });

  const error = sp.get("error");
  if (error) return go(linkReturnPath(next, { error: CODE.test(error) ? error : "INTERNAL" }));

  const ticket = sp.get("ticket") ?? "";
  if (!TICKET.test(ticket)) return go(linkReturnPath(next, { error: "LINK_TICKET_INVALID" }));
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (!token) return go(expiredUrl(linkReturnPath(next, {})));

  const r = await upstream({
    method: "POST",
    path: "/me/auth-accounts",
    body: JSON.stringify({ ticket }),
    token,
    internal: { clientIp: clientIpOf(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip")) },
  });
  if (r.status === 401) return go(expiredUrl(linkReturnPath(next, {})));
  const body = (r.body && typeof r.body === "object" ? r.body : {}) as {
    data?: { account?: { provider?: unknown }; absorbed?: unknown };
    error?: { code?: unknown };
  };
  if (r.status >= 400) return go(linkReturnPath(next, { error: typeof body.error?.code === "string" ? body.error.code : "INTERNAL" }));
  const provider = typeof body.data?.account?.provider === "string" ? body.data.account.provider : "";
  return go(linkReturnPath(next, { linked: provider || "UNKNOWN", absorbed: body.data?.absorbed === true }));
}
