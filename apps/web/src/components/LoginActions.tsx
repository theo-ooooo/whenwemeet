"use client";
// 로그인 화면 버튼 영역. 앱 셸 안이면 웹 로그인 버튼 대신 네이티브 로그인 화면을 부른다 (앱.md 4.3).
// 마운트 때 login 메시지를 한 번 보내고, 사용자가 닫았을 때를 위해 다시 열기 버튼을 둔다
import { useEffect, useRef } from "react";
import { AppleButton } from "./AppleButton";
import { KakaoButton } from "./KakaoButton";
import { Button } from "./ui";
import { postToApp } from "@/lib/app-bridge";
import { useInApp } from "@/lib/useInApp";

export function LoginActions({
  next,
  appleEnabled,
  appGuess,
  expired,
}: {
  next: string;
  appleEnabled: boolean;
  /** 서버가 UA 로 본 앱 여부. 첫 렌더 깜빡임 방지용 */
  appGuess: boolean;
  expired: boolean;
}) {
  const inApp = useInApp(appGuess);
  const sent = useRef(false);

  function openNative() {
    postToApp(expired ? { type: "login", next, reason: "expired" } : { type: "login", next });
  }

  useEffect(() => {
    if (!inApp || sent.current) return;
    sent.current = true;
    openNative();
    // 마운트 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inApp]);

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
      <KakaoButton next={next} />
      {appleEnabled && <AppleButton next={next} />}
    </div>
  );
}
