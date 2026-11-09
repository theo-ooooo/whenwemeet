import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KakaoButton } from "@/components/KakaoButton";
import { Logo } from "@/components/Logo";
import { safeNext, SESSION_COOKIE } from "@/lib/auth";

export const metadata: Metadata = { title: "로그인" };
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  OAUTH_STATE: "로그인 시간이 지났어요. 다시 시도해 주세요",
  KAKAO_ERROR: "카카오 연결에 실패했어요. 잠시 후 다시 시도해 주세요",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);

  // 이미 로그인돼 있으면 바로 이동
  const jar = await cookies();
  if (jar.get(SESSION_COOKIE)?.value) redirect(next);

  const error = sp.error ? ERROR_MESSAGES[sp.error] : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[18vh]">
      <div className="flex-1">
        <Logo variant="symbol" size={72} />
        <h1 className="mt-7 text-[34px] font-extrabold leading-[1.15] tracking-[-0.03em]">
          언제 볼까?
          <br />
          달력 하나로 끝내요
        </h1>
        <p className="mt-4 max-w-[30ch] text-[15px] leading-relaxed text-ink-2">
          카카오로 들어와 팀을 만들고 링크 하나만 보내면, 서로의 일정이 한 달력에 겹쳐 보여요. 모두 비는
          시간도 바로 찾아 드려요.
        </p>
      </div>

      <div className="mt-10">
        {error && (
          <p role="alert" className="mb-3 rounded-sm bg-paper px-4 py-3 text-[14px] text-danger">
            {error}
          </p>
        )}
        <KakaoButton next={next} />
        <p className="t-sub mt-5 text-center">
          시작하면{" "}
          <Link href="/terms" className="underline underline-offset-2">
            이용약관
          </Link>
          과{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            개인정보처리방침
          </Link>
          에 동의한 것으로 봐요
        </p>
      </div>
    </main>
  );
}
