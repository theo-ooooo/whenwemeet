"use client";
// (#549) 휴대폰 캘린더 맞추기 (docs/설계/앱.md 4.9). 로그인된 화면(AppShell)에서만 쓴다.
// 휴대폰 캘린더를 아는 셸(UA 에 DeviceCalendar/1)이 아니면 아무것도 하지 않는다. 시점과 건너뛰기 규칙은 lib/device-calendar-sync.ts
import { useEffect } from "react";
import { useDeviceCalendarSource } from "@/hooks";
import { WIDGET_DIRTY_EVENT } from "./api";
import { appSupportsDeviceCalendar, isInApp } from "./app-bridge";
import { CALENDAR_SETTINGS_EVENT, requestCalendar, storedCalendarEnabled, writeCalendarSettings } from "./device-calendar";
import { createCalendarSyncer, newSyncMemory } from "./device-calendar-sync";

// 화면(팀)이 바뀌어 AppShell 이 다시 마운트돼도 이어지게 모듈에 둔다
const memory = newSyncMemory();

export function useDeviceCalendarSync(): void {
  const load = useDeviceCalendarSource();

  useEffect(() => {
    if (!isInApp() || !appSupportsDeviceCalendar(navigator.userAgent)) return;
    const syncer = createCalendarSyncer({
      load: (now, signal) => load(now, signal),
      send: (snapshot) => requestCalendar({ type: "calendarSync", snapshot }),
      saveSettings: writeCalendarSettings,
      origin: window.location.origin,
      memory,
    });
    // 이 기기에서 켠 적이 없으면 변경, 앞으로 옴에 요청하지 않는다 (설정을 켜면 CALENDAR_SETTINGS_EVENT 로 시작)
    const onDirty = () => {
      if (storedCalendarEnabled()) syncer.dirty();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && storedCalendarEnabled()) syncer.visible();
    };
    const onSettings = () => syncer.settingsChanged();

    if (storedCalendarEnabled()) syncer.start();
    // 일정, 팀을 바꾸는 요청(/groups 아래 GET 이 아닌 요청) 성공마다 lib/api.ts 가 쏜다 (위젯과 같은 이벤트)
    window.addEventListener(WIDGET_DIRTY_EVENT, onDirty);
    window.addEventListener(CALENDAR_SETTINGS_EVENT, onSettings);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      syncer.dispose();
      window.removeEventListener(WIDGET_DIRTY_EVENT, onDirty);
      window.removeEventListener(CALENDAR_SETTINGS_EVENT, onSettings);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);
}
