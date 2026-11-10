import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KakaoButton } from "@/components/KakaoButton";
import { Symbol } from "@/components/Logo";
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
    <div className="min-h-dvh bg-[var(--login-bg)]">
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
        <Symbol size={40} />
        <ul aria-label="이런 모임이 함께 써요" className="mb-[22px] mt-auto flex flex-wrap gap-2 pt-16">
          {["커플", "가족", "친구 모임", "스터디"].map((t) => (
            <li key={t} className="rounded-full border-[1.5px] border-[var(--chip-line)] px-3 py-[7px] text-[13px] font-semibold text-soft">
              {t}
            </li>
          ))}
        </ul>
        <h1 className="text-[58px] font-extrabold leading-none tracking-[-0.06em]">
          언제
          <br />
          볼까<span className="text-brand">?</span>
        </h1>
        <p className="mt-[18px] text-[16px] font-medium leading-normal text-soft">
          카톡으로 캡처 주고받기 그만. 달력 하나 같이 보고, 다 되는 시간 바로 찾기.
        </p>

        <div className="mt-10">
          {error && (
            <p role="alert" className="mb-3 rounded-[18px] bg-surface px-4 py-3 text-[14px] font-semibold text-danger">
              {error}
            </p>
          )}
          <KakaoButton next={next} />
          <p className="mt-3.5 text-center text-[12px] font-semibold text-ink-2">
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
    </div>
  );
}
