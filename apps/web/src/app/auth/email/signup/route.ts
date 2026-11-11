// (#245) 처음 가입 닉네임 제출 (이메일-로그인.md 6-1, D-114). 쿠키 wwm_signup → API signup.
// 성공이면 wwm_session 을 싣고 wwm_signup 을 지운 뒤 { redirect: next }
import type { NextRequest } from "next/server";
import { looksLikeJwt, safeNext } from "@/lib/auth";
import { NICKNAME_MAX, nicknameOk, SIGNUP_COOKIE } from "@/lib/email-login";
import {
  badRequest,
  callEmailApi,
  clearSignup,
  clientKindOf,
  dataOf,
  forbidden,
  json,
  notConfigured,
  ok,
  readUpstreamError,
  relayError,
  sameOrigin,
  setSession,
  webEmailEnabled,
} from "@/lib/email-route";
import { errorBody } from "@/lib/envelope";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  if (!webEmailEnabled()) return notConfigured();
  const signupToken = req.cookies.get(SIGNUP_COOKIE)?.value;
  if (!signupToken) {
    return clearSignup(json(401, errorBody(401, "SIGNUP_TOKEN_INVALID", "가입 시간이 지났어요. 다시 시작해 주세요")));
  }
  const body = (await req.json().catch(() => null)) as { nickname?: unknown } | null;
  const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
  if (!nicknameOk(nickname)) return badRequest(`닉네임은 2~${NICKNAME_MAX}자로 입력해 주세요`);

  const r = await callEmailApi(req, "signup", { signupToken, nickname, client: clientKindOf(req) });
  const e = readUpstreamError(r);
  if (e) {
    const res = relayError(e);
    return e.code === "SIGNUP_TOKEN_INVALID" ? clearSignup(res) : res;
  }
  const data = (dataOf(r) ?? {}) as { token?: unknown; next?: unknown };
  if (typeof data.token !== "string" || !looksLikeJwt(data.token)) {
    return json(502, errorBody(502, "INTERNAL", "잠시 후 다시 시도해 주세요"));
  }
  const next = safeNext(typeof data.next === "string" ? data.next : null);
  return clearSignup(setSession(ok({ redirect: next }), data.token));
}
