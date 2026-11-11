"use client";
// "앱에서 열기" (#154). 카카오톡 인앱 브라우저는 유니버설 링크/앱 링크를 타지 않아 초대 링크가 웹으로 열린다.
// 2026-11-11: 보이는 버튼과 안내 문구는 뺐다(앱이 없는 사람에게도 보여 혼란). 지금은 카카오톡 + 스토어 공개 OS 에서
// 자동 시도 한 번만 하고 화면에는 아무것도 그리지 않는다. 앱이 없으면 그대로 웹 합류 화면에 남는다
// 판정(plan)은 서버가 UA 와 APP_STORE_LIVE 로 정하고(lib/app-open.ts planAppOpen), 여기서는 주소를 만들어 이동만 한다.
// 웹 합류 화면은 절대 막지 않는다: 이 블록은 기존 버튼 아래에 붙는 보조 동작이다.
// - 카카오톡: 화면을 열면 한 번 자동으로 앱을 부른다 (sessionStorage + 폴백 주소의 app=0 으로 반복 방지)
// - iOS: 앱이 없으면 아무 일도 없다. 1.5초 뒤에도 화면이 보이면 "못 열었음" 으로 보고, 스토어가 열려 있으면 설치 버튼
// - Android: intent 폴백이 웹(app=0)으로 돌아오면 같은 판정. 직접 누른 경우 스토어가 열려 있으면 폴백이 Play 스토어
import { useCallback, useEffect, useRef, useState } from "react";
import { appOpenUrl, appPathOf, autoAttemptKey, NO_APP_PARAM, NO_APP_VALUE, shouldAutoAttempt, type AppOpenPlan } from "@/lib/app-open";

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

  useEffect(() => {
    if (!plan.show) return;
    const key = autoAttemptKey(window.location.pathname);
    const search = window.location.search;
    // intent 폴백으로 돌아왔다 = Android 에 앱이 없다
    if (new URLSearchParams(search).get(NO_APP_PARAM) === NO_APP_VALUE) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 폴백 주소에서 한 번 상태를 맞춘다
      setPhase("failed");
      return;
    }
    if (!shouldAutoAttempt(plan, search, readTried(key))) return;
    markTried(key);
    attempt(false);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [plan, attempt]);

  // 화면에 그리는 것은 없다 (자동 시도만)
  void phase;
  return null;
}
