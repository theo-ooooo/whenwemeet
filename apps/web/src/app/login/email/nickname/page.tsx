// (#245) 처음 가입 닉네임 /login/email/nickname (이메일-로그인.md 6-3, D-114).
// 가입 티켓 쿠키(wwm_signup)가 없으면 이메일 입력으로 돌려보낸다. 쿠키 값은 서버에서만 본다
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import { SIGNUP_COOKIE } from "@/lib/email-login";
import { webEmailEnabled } from "@/lib/email-route";
import { isSessionUsable } from "@/lib/session";
import { EmailNicknameScreen } from "@/screens/EmailNicknameScreen";

export const metadata: Metadata = { title: "닉네임 정하기", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function EmailNicknamePage() {
  if (!webEmailEnabled()) redirect("/login");
  const jar = await cookies();
  if (isSessionUsable(jar.get(SESSION_COOKIE)?.value) && !jar.get(SIGNUP_COOKIE)?.value) redirect("/");
  if (!jar.get(SIGNUP_COOKIE)?.value) redirect("/login/email?error=SIGNUP_TOKEN_INVALID");
  return <EmailNicknameScreen />;
}
