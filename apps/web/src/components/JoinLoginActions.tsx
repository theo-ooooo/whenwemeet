"use client";
// 초대 화면(/join/<코드>) 로그인 버튼 (#129). /login 과 같은 규칙(loginChoices):
// 웹이면 카카오 + (APPLE_LOGIN_ENABLED=1 이면) 애플, 둘 다 next=/join/<코드>?auto=1 로 돌아와 바로 합류한다 (D-41).
// 앱 셸 안이면 버튼 하나로 네이티브 로그인(카카오, 애플 둘 다 네이티브가 고른다)을 부른다. /login 과 달리
// 마운트 때 자동으로 열지 않는다 (초대 내용을 먼저 보여 준다)
import { AppleButton } from "./AppleButton";
import { KakaoButton } from "./KakaoButton";
import { Button } from "./ui";
import { postToApp } from "@/lib/app-bridge";
import { loginChoices } from "@/lib/auth";
import { useInApp } from "@/lib/useInApp";

export function JoinLoginActions({ next, appleEnabled, appGuess }: { next: string; appleEnabled: boolean; appGuess: boolean }) {
  const inApp = useInApp(appGuess);
  return (
    <div className="flex flex-col gap-2">
      {loginChoices(inApp, appleEnabled).map((c) =>
        c === "native" ? (
          <Button key={c} size="lg" full onClick={() => postToApp({ type: "login", next })}>
            로그인하고 합류하기
          </Button>
        ) : c === "apple" ? (
          <AppleButton key={c} next={next} label="Apple로 로그인하고 합류하기" />
        ) : (
          <KakaoButton key={c} next={next} label="카카오로 로그인하고 합류하기" />
        ),
      )}
    </div>
  );
}
