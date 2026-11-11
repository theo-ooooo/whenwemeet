// (#245) 이메일 로그인 /login/email (이메일-로그인.md 6-1, 6-3). 스위치가 꺼져 있으면 /login 으로,
// 이미 로그인돼 있으면 next 로 (/login 과 같음). 화면은 screens/EmailLoginScreen
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext, SESSION_COOKIE } from "@/lib/auth";
import { ENTRY_ERRORS } from "@/lib/email-login";
import { webEmailEnabled } from "@/lib/email-route";
import { isSessionUsable } from "@/lib/session";
import { EmailLoginScreen } from "@/screens/EmailLoginScreen";

export const metadata: Metadata = { title: "이메일로 계속하기", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function EmailLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (!webEmailEnabled()) redirect(next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login");
  const jar = await cookies();
  if (isSessionUsable(jar.get(SESSION_COOKIE)?.value)) redirect(next);
  const entryError = sp.error ? (ENTRY_ERRORS[sp.error] ?? null) : null;
  return <EmailLoginScreen next={next} entryError={entryError} />;
}
