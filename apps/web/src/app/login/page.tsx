import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginActions } from "@/components/LoginActions";
import { Symbol } from "@/components/Logo";
import { parseAppUserAgent } from "@/lib/app-bridge";
import { EXPIRED_REASON, safeNext, SESSION_COOKIE, webAppleEnabled } from "@/lib/auth";

export const metadata: Metadata = { title: "로그인" };
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  OAUTH_STATE: "로그인 시간이 지났어요. 다시 시도해 주세요",
  KAKAO_ERROR: "카카오 연결에 실패했어요. 잠시 후 다시 시도해 주세요",
  HANDOFF_INVALID: "로그인이 만료됐어요. 다시 시도해 주세요",
};
/** 문구 없이 화면만 그리는 오류 (사용자가 직접 취소, 앱.md 8장) */
const SILENT_ERRORS = new Set(["APPLE_CANCELLED"]);
const DEFAULT_ERROR = "로그인하지 못했어요. 잠시 후 다시 시도해 주세요";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reason?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);

  // 이미 로그인돼 있으면 바로 이동
  const jar = await cookies();
  if (jar.get(SESSION_COOKIE)?.value) redirect(next);

  const error = sp.error && !SILENT_ERRORS.has(sp.error) ? (ERROR_MESSAGES[sp.error] ?? DEFAULT_ERROR) : null;
  // 앱 셸 판정(UA)과 웹 애플 버튼 노출(P3 배포 전 숨김, 앱.md 7장)은 요청마다 서버에서 읽는다
  // Android 앱 셸 안에서는 애플 버튼을 숨긴다 (#145)
  const appUa = parseAppUserAgent((await headers()).get("user-agent"));
  const appGuess = appUa !== null;
  const appleEnabled = webAppleEnabled(process.env.APPLE_LOGIN_ENABLED, appUa?.os);

  return (
    <div className="min-h-dvh bg-[var(--login-bg)]">
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
        <Symbol size={40} />
        <ul aria-label="이런 모임이 함께 써요" className="mb-4 mt-auto flex flex-wrap gap-1.5 pt-16">
          {["커플", "가족", "친구 모임", "스터디"].map((t) => (
            <li key={t} className="rounded-sm border border-line px-2.5 py-1 text-[12px] font-medium text-soft">
              {t}
            </li>
          ))}
        </ul>
        <h1 className="text-[44px] font-bold leading-none tracking-[-0.04em]">
          언제
          <br />
          볼까<span className="text-acc-ink">?</span>
        </h1>
        <p className="mt-3 text-[15px] leading-[22px] text-soft">
          카톡으로 캡처 주고받기 그만. 달력 하나 같이 보고, 다 되는 시간 바로 찾기.
        </p>

        <div className="mt-8">
          {error && (
            <p role="alert" className="mb-3 rounded-sm bg-surface px-3.5 py-2.5 text-[13px] text-danger">
              {error}
            </p>
          )}
          <LoginActions next={next} appleEnabled={appleEnabled} appGuess={appGuess} expired={sp.reason === EXPIRED_REASON} />
          <p className="mt-3 text-center text-[12px] text-ink-2">
            계속하면{" "}
            <Link href="/terms" className="hit inline-block underline underline-offset-2">
              이용약관
            </Link>
            과{" "}
            <Link href="/privacy" className="hit inline-block underline underline-offset-2">
              개인정보처리방침
            </Link>
            에 동의한 것으로 봐요
          </p>
        </div>
      </main>
    </div>
  );
}
