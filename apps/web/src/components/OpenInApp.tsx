"use client";
// "앱에서 열기" (#154). 카카오톡 인앱 브라우저는 유니버설 링크/앱 링크를 타지 않아 초대 링크가 웹으로 열린다.
// 2026-11-11 (D-72): 화면 속 버튼 대신, 모바일 브라우저 + 그 OS 앱 스토어 공개일 때 "앱으로 이용하기 / 웹으로 이용하기"
// 시트를 한 번 띄운다. 앱으로: 앱이 있으면 앱에서 이 초대가 열리고 없으면 스토어로. 웹으로: 닫고 이 화면에서 합류.
// 답한 뒤에는 같은 탭(sessionStorage) 에서 다시 묻지 않는다
// 판정(plan)은 서버가 UA 와 APP_STORE_LIVE 로 정하고(lib/app-open.ts planAppOpen), 여기서는 주소를 만들어 이동만 한다.
// 웹 합류 화면은 절대 막지 않는다: 이 블록은 기존 버튼 아래에 붙는 보조 동작이다.
// - 카카오톡: 화면을 열면 한 번 자동으로 앱을 부른다 (sessionStorage + 폴백 주소의 app=0 으로 반복 방지)
// - iOS: 앱이 없으면 아무 일도 없다. 1.5초 뒤에도 화면이 보이면 "못 열었음" 으로 보고, 스토어가 열려 있으면 설치 버튼
// - Android: intent 폴백이 웹(app=0)으로 돌아오면 같은 판정. 직접 누른 경우 스토어가 열려 있으면 폴백이 Play 스토어
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Sheet } from "./ui";
import { appOpenUrl, appPathOf, autoAttemptKey, shouldAutoAttempt, type AppOpenPlan } from "@/lib/app-open";

const OPEN_TIMEOUT_MS = 1500;

type Phase = "idle" | "opening" | "failed" | "dismissed";

function readTried(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function markTried(key: string): void {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {}
}

export function OpenInApp({ plan }: { plan: AppOpenPlan }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attempt = useCallback(
    (manual: boolean) => {
      if (!plan.show) return;
      const path = appPathOf(window.location.pathname, window.location.search);
      if (!path) return;
      setPhase("opening");
      // 앱이 열리면 이 페이지는 숨겨진다. 그 사이에 타이머가 끝나도 숨김 상태면 실패로 보지 않는다
      let hidden = false;
      const onHide = () => {
        if (document.visibilityState === "hidden") hidden = true;
      };
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", onHide);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("pagehide", onHide);
        if (hidden || document.visibilityState === "hidden") {
          setPhase("idle");
          return;
        }
        // iOS 에서 사용자가 직접 눌렀고 스토어가 열려 있으면 바로 App Store 로 (사용자 동작이라 강제 이동이 아니다)
        if (manual && plan.os === "ios" && plan.storeUrl) {
          window.location.href = plan.storeUrl;
          setPhase("failed");
          return;
        }
        setPhase("failed");
      }, OPEN_TIMEOUT_MS);
      window.location.href = appOpenUrl(plan.os, window.location.origin, path, { manual, storeUrl: plan.storeUrl });
    },
    [plan],
  );

  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!plan.show) return;
    const key = autoAttemptKey(window.location.pathname);
    if (!shouldAutoAttempt(plan, window.location.search, readTried(key))) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 처음 연 화면에서 한 번 묻는다
    setAsking(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [plan]);

  const answer = (useApp: boolean) => {
    markTried(autoAttemptKey(window.location.pathname));
    setAsking(false);
    if (useApp) attempt(true);
  };

  if (!plan.show) return null;
  return (
    <Sheet open={asking} onClose={() => answer(false)} title="언제볼까 앱으로 열까요?">
      <p className="text-[14px] leading-5 text-soft">
        앱이 있으면 바로 앱에서 열리고, 없으면 {plan.os === "ios" ? "App Store" : "Play 스토어"}로 이동해요.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <Button size="xl" full loading={phase === "opening"} onClick={() => answer(true)}>
          앱으로 이용하기
        </Button>
        <Button variant="ghost" size="xl" full onClick={() => answer(false)}>
          웹으로 이용하기
        </Button>
      </div>
    </Sheet>
  );
}
