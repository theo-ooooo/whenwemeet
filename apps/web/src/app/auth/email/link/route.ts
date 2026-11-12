// (#245) 메일 링크 확인 화면의 [로그인 계속하기] form POST (이메일-로그인.md 6-1, 6-4, D-113).
// 결과는 code 와 같고 응답은 303 이동. 세션이면 착지 화면(/auth/landing?next=)으로 (#307, 앱 링크 경로로 바로 303 하면 Android 가 앱으로 넘긴다). 실패면 토큰 없이 /auth/email?error=<reason> 으로 (토큰이 주소, 기록에 남지 않게)
import { type NextRequest, NextResponse } from "next/server";
import { LINK_TOKEN_RE, readEmailErrorDetails } from "@/lib/email-login";
import {
  applyAuthResult,
  callEmailApi,
  clientKindOf,
  dataOf,
  EMAIL_ROUTE_HEADERS,
  forbidden,
  readUpstreamError,
  sameOrigin,
  webEmailEnabled,
  withAuthCookies,
} from "@/lib/email-route";
import { isMock } from "@/lib/upstream";

function see(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.nextUrl.origin), { status: 303, headers: EMAIL_ROUTE_HEADERS });
}

const fail = (req: NextRequest, reason: string) => see(req, `/auth/email?error=${encodeURIComponent(reason)}`);

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  if (!webEmailEnabled()) return fail(req, "EMAIL_NOT_CONFIGURED");
  const form = await req.formData().catch(() => null);
  const raw = form?.get("token");
  const token = typeof raw === "string" ? raw : "";
  // 목 모드는 짧은 목 토큰(mock, mock-used ...)도 받는다
  if (!LINK_TOKEN_RE.test(token) && !(isMock() && token.startsWith("mock"))) return fail(req, "INVALID");

  const r = await callEmailApi(req, "link", { token, client: clientKindOf(req) });
  const e = readUpstreamError(r);
  if (e) {
    if (e.code === "EMAIL_LINK_INVALID") return fail(req, readEmailErrorDetails(e.details).reason ?? "INVALID");
    if (e.code === "EMAIL_NOT_CONFIGURED") return fail(req, e.code);
    return fail(req, "UNAVAILABLE");
  }
  const done = applyAuthResult(dataOf(r));
  if (!done) return fail(req, "UNAVAILABLE");
  return withAuthCookies(see(req, done.redirect), done.result);
}
