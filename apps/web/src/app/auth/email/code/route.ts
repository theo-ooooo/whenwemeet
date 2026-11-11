// (#245) 6자리 코드로 로그인 (이메일-로그인.md 6-1). 기존 계정이면 wwm_session, 처음이면 wwm_signup 을 싣고
// { redirect } 를 돌려준다 (SESSION: 행에 저장된 next, SIGNUP: 닉네임 화면). 토큰은 응답 본문에 싣지 않는다
import type { NextRequest } from "next/server";
import { normalizeOtp, OTP_LENGTH } from "@/lib/email-login";
import {
  applyAuthResult,
  badRequest,
  callEmailApi,
  clientKindOf,
  dataOf,
  forbidden,
  json,
  notConfigured,
  ok,
  readUpstreamError,
  relayError,
  sameOrigin,
  webEmailEnabled,
  withAuthCookies,
} from "@/lib/email-route";
import { errorBody } from "@/lib/envelope";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  if (!webEmailEnabled()) return notConfigured();
  const body = (await req.json().catch(() => null)) as { email?: unknown; code?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const code = typeof body?.code === "string" ? normalizeOtp(body.code) : "";
  if (!email || code.length !== OTP_LENGTH) return badRequest("코드 6자리를 다시 확인해 주세요");

  const r = await callEmailApi(req, "code", { email, code, client: clientKindOf(req) });
  const e = readUpstreamError(r);
  if (e) return relayError(e);
  const done = applyAuthResult(dataOf(r));
  if (!done) return json(502, errorBody(502, "INTERNAL", "잠시 후 다시 시도해 주세요"));
  return withAuthCookies(ok({ redirect: done.redirect }), done.result);
}
