// (#245) 로그인 메일 요청 (이메일-로그인.md 6-1). 브라우저 JSON { email, next } → API request (웹 서버 전용 헤더)
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/auth";
import { EMAIL_MAX_LENGTH } from "@/lib/email-login";
import {
  badRequest,
  callEmailApi,
  dataOf,
  forbidden,
  notConfigured,
  ok,
  readUpstreamError,
  relayError,
  sameOrigin,
  webEmailEnabled,
} from "@/lib/email-route";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  if (!webEmailEnabled()) return notConfigured();
  const body = (await req.json().catch(() => null)) as { email?: unknown; next?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email || email.length > EMAIL_MAX_LENGTH) return badRequest("이메일 주소를 다시 확인해 주세요");
  const next = safeNext(typeof body?.next === "string" ? body.next : null);

  const r = await callEmailApi(req, "request", { email, next });
  const e = readUpstreamError(r);
  if (e) return relayError(e);
  return ok(dataOf(r) ?? {});
}
