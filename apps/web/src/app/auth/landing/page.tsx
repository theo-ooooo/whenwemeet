// (#307) 로그인 직후 착지 화면 /auth/landing?next= (lib/auth.ts landingPath).
// 이메일 링크 303, 코드, 닉네임 가입이 세션을 만든 뒤 여기로 문서 이동한다. 이 경로는 앱 링크가 아니라 Android 브라우저가
// 앱으로 넘기지 않는다. 여기서 next(/join/.., 옛 /g/..) 로는 클라이언트 이동만 해서 로그인한 브라우저에 그대로 남는다
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LandingRedirect } from "@/components/LandingRedirect";
import { Symbol } from "@/components/Logo";
import { safeNext, SESSION_COOKIE } from "@/lib/auth";
import { isSessionUsable } from "@/lib/session";

export const metadata: Metadata = { title: "언제볼까", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const jar = await cookies();
  // 세션 없이 직접 연 경우는 로그인 화면으로 (/login 은 앱 링크가 아니다)
  if (!isSessionUsable(jar.get(SESSION_COOKIE)?.value)) {
    redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
      <Symbol size={32} />
      <div className="mt-auto pt-16">
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">로그인했어요</h1>
        <p role="status" className="mt-3 text-[15px] leading-[22px] text-soft">
          언제볼까를 여는 중이에요
        </p>
        <div className="mt-8">
          <LandingRedirect next={next} />
        </div>
      </div>
    </main>
  );
}
