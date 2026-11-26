"use client";
// (#490) 앱 셸 연동(푸시 토큰, 위젯 스냅샷, (#549) 휴대폰 캘린더, 알림 안내)과 입력 방식 추적. AppShell 에서 옮김
import { useEffect } from "react";
import { trackInputModality } from "@/lib/input-modality";
import { maybeOpenPushPrompt } from "@/lib/push";
import { usePushSync } from "@/lib/usePushSync";
import { useWidgetSync } from "@/lib/useWidgetSync";
import { useDeviceCalendarSync } from "@/lib/useDeviceCalendarSync";

export function useShellAppEffects() {
  // (#188) 푸시 지원 앱이면 이 기기 토큰을 등록, 정리 (처음 그릴 때와 앱이 앞으로 올 때)
  usePushSync();
  // (#197) 홈 화면 위젯 스냅샷 (위젯을 아는 앱 셸에서만)
  useWidgetSync();
  // (#549) 휴대폰 캘린더 (휴대폰 캘린더를 아는 앱 셸에서, 이 기기에서 켰을 때만)
  useDeviceCalendarSync();
  // (#291) 앱을 열면 알림 안내를 띄운다. 첫 화면이 그려진 뒤 잠깐 두고 묻는다 (웹, 1.0.x 앱, 이미 답한 기기는 아무것도 안 함)
  useEffect(() => {
    const t = window.setTimeout(() => void maybeOpenPushPrompt(), 800);
    return () => window.clearTimeout(t);
  }, []);
  // (#339) 키보드로 연 패널만 제목 포커스 테두리를 그리게 마지막 입력 방식을 지켜본다
  useEffect(() => trackInputModality(), []);
}
