"use client";
// 로그인 화면 버튼 영역. 앱 셸 안이면 웹 로그인 버튼 대신 네이티브 로그인 화면을 부른다 (앱.md 4.3).
// 마운트 때 login 메시지를 한 번 보내고, 사용자가 닫았을 때를 위해 다시 열기 버튼을 둔다.
// (#245) 이메일 버튼을 모르는 셸(UA 에 EmailLogin/1 없음)이고 스위치가 켜져 있으면 자동으로 열지 않고 선택 화면을 보인다
// (이메일-로그인.md 7장, D-116)
import { useEffect, useRef } from "react";
import { AppleButton } from "./AppleButton";
import { EmailLoginButton } from "./EmailLoginButton";
import { KakaoButton } from "./KakaoButton";
import { Button } from "./ui";
import { postToApp } from "@/lib/app-bridge";
import { appLoginMode, loginChoices } from "@/lib/auth";
import { useInApp } from "@/lib/useInApp";

export function LoginActions({
  next,
  appleEnabled,
  appGuess,
  expired,
  emailEnabled = false,
  shellHasEmail = false,
  appOs = null,
}: {
  next: string;
  appleEnabled: boolean;
  /** 서버가 UA 로 본 앱 여부. 첫 렌더 깜빡임 방지용 */
  appGuess: boolean;
  expired: boolean;
  /** EMAIL_LOGIN_ENABLED (서버에서 읽음) */
  emailEnabled?: boolean;
  /** 셸 네이티브 로그인 화면에 이메일 버튼이 있음 (UA EmailLogin/1) */
  shellHasEmail?: boolean;
  /** 앱 셸 OS (선택 화면 버튼 문구) */
  appOs?: "ios" | "android" | null;
}) {
  const inApp = useInApp(appGuess);
  const mode = appLoginMode(emailEnabled, shellHasEmail);
  const sent = useRef(false);

  function openNative() {
    postToApp(expired ? { type: "login", next, reason: "expired" } : { type: "login", next });
  }

  useEffect(() => {
    if (!inApp || mode !== "native" || sent.current) return;
    sent.current = true;
    openNative();
    // 마운트 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inApp, mode]);

  if (inApp && mode === "chooser") {
    return (
      <div className="flex flex-col gap-2">
        <Button size="xl" full onClick={openNative}>
          {appOs === "android" ? "카카오로 계속하기" : "카카오 또는 Apple로 계속하기"}
        </Button>
        <EmailLoginButton next={next} />
      </div>
    );
  }

  if (inApp) {
    return (
      <div>
        <p role="status" className="mb-3 text-center text-[14px] font-semibold text-soft">
          로그인 화면을 여는 중이에요
        </p>
        <Button size="lg" full onClick={openNative}>
          로그인 화면 다시 열기
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {loginChoices(false, appleEnabled, emailEnabled).map((c) =>
        c === "apple" ? <AppleButton key={c} next={next} /> : c === "email" ? <EmailLoginButton key={c} next={next} /> : <KakaoButton key={c} next={next} />,
      )}
    </div>
  );
}
