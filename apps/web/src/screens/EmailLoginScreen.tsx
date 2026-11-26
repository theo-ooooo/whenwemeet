"use client";
// (#245) 이메일 로그인 /login/email (이메일-로그인.md 6-3, 6-6). 한 화면의 두 단계:
// ① 이메일 입력 → [메일 받기]  ② "메일을 보냈어요" 코드 6칸(다 차면 바로 제출), [다시 보내기](60초), "다른 이메일로".
// ② 단계는 sessionStorage 에 남겨 새로고침과 메일 앱 왕복에도 유지한다 (15분)
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { CodeInput } from "@/components/CodeInput";
import { Symbol } from "@/components/Logo";
import { useToast } from "@/components/Toast";
import { Button, inputClass } from "@/components/ui";
import { useRequestEmailLogin, useVerifyEmailCode, type ApiFailure } from "@/hooks";
import { haptic } from "@/lib/app-bridge";
import {
  codeErrorMessage,
  DEFAULT_COOLDOWN_SEC,
  EMAIL_MAX_LENGTH,
  formatCountdown,
  isEmailShape,
  normalizeEmail,
  OTP_LENGTH,
  readEmailErrorDetails,
  requestErrorMessage,
  secondsLeft,
} from "@/lib/email-login";
import { useSentState, writeSentState } from "@/lib/useEmailLoginState";

/** 요청 실패가 쿨다운이면 남은 초 (① 에서 ② 로 넘기는 데 쓴다) */
function cooldownOf(f: ApiFailure): number | null {
  if (f.code !== "EMAIL_RATE_LIMITED") return null;
  const info = readEmailErrorDetails(f.details);
  return info.reason === "COOLDOWN" ? (info.retryAfterSec ?? DEFAULT_COOLDOWN_SEC) : null;
}

const requestMessage = (f: ApiFailure) => requestErrorMessage(f.code, readEmailErrorDetails(f.details));

export function EmailLoginScreen({ next, entryError }: { next: string; entryError: string | null }) {
  const { sent, now } = useSentState();
  const [email, setEmail] = useState("");
  const [requestError, setRequestError] = useState<string | null>(entryError);
  const request = useRequestEmailLogin();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!isEmailShape(email) || request.isPending) return;
    const target = normalizeEmail(email);
    setRequestError(null);
    const r = await request.mutate({ email: target, next });
    const at = Math.floor(Date.now() / 1000) * 1000; // 1초 시계(useNowTick)와 같은 눈금이라 처음 표시가 1:00
    if (r.ok) {
      writeSentState({ email: target, sentAt: at, cooldownUntil: at + (r.data.cooldownSec ?? DEFAULT_COOLDOWN_SEC) * 1000 });
      return;
    }
    // 60초 안에 같은 메일을 다시 요청: 이미 메일이 가 있으니 ② 로 넘기고 남은 초로 센다 (6-6)
    const wait = cooldownOf(r.error);
    if (wait !== null) {
      writeSentState({ email: target, sentAt: at, cooldownUntil: at + wait * 1000 });
      return;
    }
    setRequestError(requestMessage(r.error));
  }

  function otherEmail() {
    if (sent) setEmail(sent.email);
    setRequestError(null);
    writeSentState(null);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(24px+var(--sab))] pt-[max(12px,var(--sat))] lg:pt-6">
      <div className="flex h-8 items-center">
        {/* 진입 화면 공통: 바탕 --bg, 로고 32, 제목 24/700, 좌우 24 (#174 L4) */}
        <Symbol size={32} />
      </div>
      {now === 0 ? null : sent ? (
        <SentStep key={`${sent.email}:${sent.sentAt}`} next={next} email={sent.email} cooldownUntil={sent.cooldownUntil} now={now} onOtherEmail={otherEmail} />
      ) : (
        <form onSubmit={send} noValidate className="mt-8 flex flex-1 flex-col">
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.03em]">이메일로 계속하기</h1>
          <p className="mt-2 text-[15px] leading-[22px] text-soft">로그인 링크와 6자리 코드를 보내 드려요. 처음이면 바로 가입돼요.</p>
          <EmailField
            value={email}
            onChange={(v) => {
              setEmail(v);
              setRequestError(null);
            }}
            error={requestError}
            disabled={request.isPending}
          />
          <div className="mt-6">
            <Button type="submit" variant="primary" size="xl" full disabled={!isEmailShape(email)} loading={request.isPending}>
              메일 받기
            </Button>
            <Link
              href={next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login"}
              className="hit mx-auto mt-3 flex h-10 w-fit items-center px-2 text-[13.5px] font-semibold text-soft underline-offset-2 hover:underline"
            >
              다른 방법으로 로그인
            </Link>
          </div>
        </form>
      )}
    </main>
  );
}

function EmailField({ value, onChange, error, disabled }: { value: string; onChange: (v: string) => void; error: string | null; disabled: boolean }) {
  const id = useId();
  return (
    <div className="mt-6 rounded-xl bg-paper px-3.5 py-3.5">
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-ink-2">
        이메일
      </label>
      <input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        autoFocus
        maxLength={EMAIL_MAX_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        disabled={disabled}
        placeholder="name@example.com"
        className={inputClass}
      />
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-2 text-[13px] leading-[18px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** ② 메일을 보냈어요. key 가 바뀌면(다시 보내기) 입력과 오류가 처음 상태로 돌아간다 */
function SentStep({
  next,
  email,
  cooldownUntil,
  now,
  onOtherEmail,
}: {
  next: string;
  email: string;
  cooldownUntil: number;
  now: number;
  onOtherEmail: () => void;
}) {
  const id = useId();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  // 잠김, 만료: 이 메일의 코드는 끝났다. 다시 보내기 전까지 칸을 막는다
  const [dead, setDead] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const verify = useVerifyEmailCode();
  const request = useRequestEmailLogin();
  const wait = secondsLeft(cooldownUntil, now);

  async function submit(c: string) {
    if (verify.isPending || dead) return;
    const r = await verify.mutate({ email, code: c });
    if (r.ok) {
      haptic("success");
      writeSentState(null);
      // 새 쿠키로 서버 화면을 다시 그리도록 전체 이동
      window.location.assign(r.data.redirect);
      return;
    }
    haptic("error");
    setCodeError(codeErrorMessage(r.error.code, readEmailErrorDetails(r.error.details)));
    setCode("");
    if (r.error.code === "EMAIL_CODE_LOCKED" || r.error.code === "EMAIL_CODE_EXPIRED") setDead(true);
    else requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onCode(c: string) {
    setCode(c);
    if (codeError && c.length > 0) setCodeError(null);
    if (c.length === OTP_LENGTH) void submit(c);
  }

  async function resend() {
    if (wait > 0 || request.isPending) return;
    setResendError(null);
    const r = await request.mutate({ email, next });
    const at = Math.floor(Date.now() / 1000) * 1000; // 1초 시계(useNowTick)와 같은 눈금이라 처음 표시가 1:00
    if (r.ok) {
      toast.show("새 메일을 보냈어요. 이전 코드는 쓸 수 없어요");
      writeSentState({ email, sentAt: at, cooldownUntil: at + (r.data.cooldownSec ?? DEFAULT_COOLDOWN_SEC) * 1000 });
      return;
    }
    const cw = cooldownOf(r.error);
    if (cw !== null) {
      // 다른 탭에서 방금 보냈다. 기다릴 시간만 맞춘다 (코드는 그대로 쓸 수 없으니 새 메일 안내)
      writeSentState({ email, sentAt: at, cooldownUntil: at + cw * 1000 });
    }
    setResendError(requestMessage(r.error));
  }

  return (
    <div className="mt-8 flex flex-1 flex-col">
      <h1 className="text-[24px] font-bold leading-8 tracking-[-0.03em]">메일을 보냈어요</h1>
      <p className="mt-2 break-keep text-[15px] leading-[22px] text-soft">
        <b className="break-all font-semibold text-ink">{email}</b> 으로 보낸 메일의 [언제볼까 시작하기]를 누르거나, 코드 6자리를 입력하세요.
      </p>

      <div className="mt-6 rounded-xl bg-paper px-3.5 py-3.5">
        <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-ink-2">
          로그인 코드 6자리
        </label>
        <CodeInput
          id={id}
          kind="otp"
          inputRef={inputRef}
          value={code}
          onChange={onCode}
          describedBy={`${id}-msg`}
          invalid={Boolean(codeError)}
          disabled={verify.isPending || dead}
          autoFocus
        />
        {codeError ? (
          <p id={`${id}-msg`} role="alert" className="mt-2 text-[13px] leading-[18px] text-danger">
            {codeError}
          </p>
        ) : (
          <p id={`${id}-msg`} className="t-sub mt-2" aria-live="polite">
            {verify.isPending ? "확인하는 중…" : "6자리를 다 넣으면 바로 로그인돼요"}
          </p>
        )}
      </div>

      <div className="mt-6">
        {/* 설계는 secondary 지만 --hover 면이 페이지 바탕(--bg)과 같은 색이라 보이지 않아 outline (ui.tsx outline, #166) */}
        <Button variant="outline" size="lg" full onClick={resend} disabled={wait > 0} loading={request.isPending}>
          {wait > 0 ? `다시 보내기 (${formatCountdown(wait)})` : "다시 보내기"}
        </Button>
        {resendError && (
          <p role="alert" className="mt-2 text-[13px] leading-[18px] text-danger">
            {resendError}
          </p>
        )}
        <button
          type="button"
          onClick={onOtherEmail}
          className="hit mx-auto mt-3 flex h-10 items-center px-2 text-[13.5px] font-semibold text-soft underline-offset-2 hover:underline"
        >
          다른 이메일로
        </button>
        <p className="mt-2 text-center text-[13px] leading-[18px] text-ink-2">메일이 안 보이면 스팸함을 확인해 주세요</p>
      </div>
    </div>
  );
}
