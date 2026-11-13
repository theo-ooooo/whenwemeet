// (#198) 웹 OAuth 로그인 방법 연결 시작 (D-257). 로그인 방법 화면의 form POST(provider, next) 만 받는다.
// 세션으로 API 에서 시작 표식(intent, 시작한 사용자 id 서명)을 받아 `/v1/auth/<제공자>?mode=link&intent=&next=` 로 보낸다.
// 표식이 없으면 API 콜백은 로그인 대신 티켓을 만들지 않는다. 앱 셸 안에서는 쓰지 않는다(셸이 /auth/kakao 를 가로챈다)
import { type NextRequest, NextResponse } from "next/server";
import { ACCOUNTS_PATH, linkReturnPath } from "@/lib/account-link";
import { safeNext, SESSION_COOKIE } from "@/lib/auth";
import { clientIpOf } from "@/lib/email-login";
import { sameOrigin } from "@/lib/email-route";
import { errorBody } from "@/lib/envelope";
import { expiredUrl } from "@/lib/session";
import { apiUrl, isMock, upstream } from "@/lib/upstream";

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

function see(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.nextUrl.origin), { status: 303, headers: HEADERS });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json(errorBody(403, "FORBIDDEN", "허용되지 않은 요청이에요"), { status: 403, headers: HEADERS });
  const form = await req.formData().catch(() => null);
  const raw = form?.get("provider");
  const provider = raw === "KAKAO" || raw === "APPLE" ? raw : null;
  const nextRaw = form?.get("next");
  const next = safeNext(typeof nextRaw === "string" ? nextRaw : ACCOUNTS_PATH);
  if (!provider) return see(req, linkReturnPath(next, { error: "VALIDATION_FAILED" }));

  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (!token) return see(req, expiredUrl(next));

  const r = await upstream({
    method: "POST",
    path: "/me/auth-accounts/link-start",
    body: JSON.stringify({ provider }),
    token,
    internal: { clientIp: clientIpOf(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip")) },
  });
  if (r.status === 401) return see(req, expiredUrl(next));
  const body = (r.body && typeof r.body === "object" ? r.body : {}) as { data?: { intent?: unknown }; error?: { code?: unknown } };
  if (r.status >= 400 || typeof body.data?.intent !== "string") {
    const code = typeof body.error?.code === "string" ? body.error.code : "INTERNAL";
    return see(req, linkReturnPath(next, { error: code, provider }));
  }
  // 결과 토스트에 제공자 이름을 쓰려고 돌아올 주소에 provider 를 실어 둔다 (콜백은 제공자를 모른다)
  const back = linkReturnPath(next, { provider });

  if (isMock()) {
    // 목: 카카오, Apple 없이 바로 연결 착지로 (티켓 mock-<제공자>)
    const url = new URL("/me/link", req.nextUrl.origin);
    url.searchParams.set("ticket", `mock-${provider}`);
    url.searchParams.set("next", back);
    return NextResponse.redirect(url, { status: 303, headers: HEADERS });
  }

  const target = new URL(`${apiUrl()}/v1/auth/${provider === "KAKAO" ? "kakao" : "apple"}`);
  target.searchParams.set("mode", "link");
  target.searchParams.set("intent", body.data.intent);
  target.searchParams.set("next", back);
  return NextResponse.redirect(target, { status: 303, headers: HEADERS });
}
