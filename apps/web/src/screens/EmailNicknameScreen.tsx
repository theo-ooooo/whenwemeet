"use client";
// (#245) 처음 가입 닉네임 (이메일-로그인.md 6-3, D-114). 기본값 없음, 앞뒤 공백 뺀 2~20자일 때만 [시작하기].
// 성공하면 서버가 준 착지 화면(/auth/landing?next=, #307)으로 전체 이동. 착지 화면이 next 로 보낸다
// (초대로 왔으면 /join/<코드>?auto=1 이 바로 합류시킨다)
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Symbol } from "@/components/Logo";
import { Button, inputClass } from "@/components/ui";
import { useEmailSignup } from "@/hooks";
import { haptic } from "@/lib/app-bridge";
import { GENERIC_ERROR, NICKNAME_MAX, nicknameOk } from "@/lib/email-login";

export function EmailNicknameScreen() {
  const id = useId();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const signup = useEmailSignup();
  const okName = nicknameOk(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!okName || signup.isPending) return;
    const r = await signup.mutate(name.trim());
    if (r.ok) {
      haptic("success");
      window.location.assign(r.data.redirect);
      return;
    }
    if (r.error.code === "SIGNUP_TOKEN_INVALID") {
      router.replace("/login/email?error=SIGNUP_TOKEN_INVALID");
      return;
    }
    setError(r.error.code === "VALIDATION_FAILED" ? `닉네임은 2~${NICKNAME_MAX}자로 입력해 주세요` : GENERIC_ERROR);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] lg:pt-6">
      <div className="flex h-8 items-center">
        <Symbol size={32} />
      </div>
      <form onSubmit={submit} noValidate className="mt-8 flex flex-1 flex-col">
        <h1 className="text-[24px] font-bold leading-8 tracking-[-0.03em]">어떻게 불러 드릴까요?</h1>
        <p className="mt-2 text-[15px] leading-[22px] text-soft">팀원에게 보이는 이름이에요. 나중에 내 정보에서 바꿀 수 있어요.</p>
        <div className="mt-6 rounded-xl bg-paper px-3.5 py-3.5">
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor={id} className="block text-[12px] font-medium text-ink-2">
              닉네임
            </label>
            <span className="text-[12px] tabular-nums text-ink-2" aria-hidden="true">
              {name.length}/{NICKNAME_MAX}
            </span>
          </div>
          <input
            id={id}
            value={name}
            onChange={(e) => {
              setName(e.target.value.slice(0, NICKNAME_MAX));
              setError(null);
            }}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            enterKeyHint="go"
            autoFocus
            disabled={signup.isPending}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-msg`}
            placeholder="2~20자"
            className={inputClass}
          />
          {error ? (
            <p id={`${id}-msg`} role="alert" className="mt-2 text-[13px] leading-[18px] text-danger">
              {error}
            </p>
          ) : (
            <p id={`${id}-msg`} className="t-sub mt-2">
              앞뒤 공백을 뺀 2~{NICKNAME_MAX}자
            </p>
          )}
        </div>
        <div className="mt-6">
          <Button type="submit" size="xl" full disabled={!okName} loading={signup.isPending}>
            시작하기
          </Button>
        </div>
      </form>
    </main>
  );
}
