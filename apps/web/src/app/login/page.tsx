import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginActions } from "@/components/LoginActions";
import { Symbol } from "@/components/Logo";
import { appSupportsEmailLogin, parseAppUserAgent } from "@/lib/app-bridge";
import { webEmailEnabled } from "@/lib/email-route";
import { EXPIRED_REASON, safeNext, SESSION_COOKIE, webAppleEnabled } from "@/lib/auth";
import { RATE_LIMITED_MESSAGE } from "@/lib/envelope";

export const metadata: Metadata = { title: "로그인" };
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  OAUTH_STATE: "로그인 시간이 지났어요. 다시 시도해 주세요",
  KAKAO_ERROR: "카카오 연결에 실패했어요. 잠시 후 다시 시도해 주세요",
  HANDOFF_INVALID: "로그인이 만료됐어요. 다시 시도해 주세요",
  // (#186) API 요청 제한. 브라우저 로그인 경로는 API 가 302 로, 앱 handoff 는 /auth/app 이 이리로 보낸다
  RATE_LIMITED: RATE_LIMITED_MESSAGE,
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
  const ua = (await headers()).get("user-agent");
  const appUa = parseAppUserAgent(ua);
  const appGuess = appUa !== null;
  const appleEnabled = webAppleEnabled(process.env.APPLE_LOGIN_ENABLED, appUa?.os);

  return (
    <div className="min-h-dvh bg-surface">
      {/* 진입 화면 공통 바탕 --bg, 로고 32, 좌우 24. 제목만 브랜드 크기 (#174 L4) */}
      <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))] fold:justify-center fold:py-16">
        {/* (#438) 넓은 화면(≥600)은 로고와 내용을 한 덩어리로 세로 가운데. 폰은 아래 붙임 그대로 (초대 화면 #429 와 같은 규칙) */}
        <Symbol size={32} />
        <ul aria-label="이런 모임이 함께 써요" className="mb-4 mt-auto flex flex-wrap gap-1.5 pt-16 fold:mt-12 fold:pt-0">
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
            <p role="alert" className="mb-3 rounded-sm bg-paper px-3.5 py-2.5 text-[13px] text-danger">
              {error}
            </p>
          )}
          <LoginActions
            next={next}
            appleEnabled={appleEnabled}
            appGuess={appGuess}
            expired={sp.reason === EXPIRED_REASON}
            emailEnabled={webEmailEnabled()}
            shellHasEmail={appSupportsEmailLogin(ua)}
            appOs={appUa?.os ?? null}
          />
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
          <p className="mt-1 text-center text-[12px] text-ink-2">
            <Link href="/support" className="hit inline-block underline underline-offset-2">
              고객 지원
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
