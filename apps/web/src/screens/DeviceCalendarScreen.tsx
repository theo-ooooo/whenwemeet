"use client";
// (#549) 내 정보 > 휴대폰 캘린더 (docs/설계/앱.md 4.9, D-294). 휴대폰 캘린더를 아는 앱 셸(UA 에 DeviceCalendar/1)에서만 내 정보에 줄이 보인다.
//   "휴대폰 캘린더에 표시" 스위치: 켜면 셸이 캘린더 권한을 묻고 "언제볼까" 캘린더를 만든다. 끄면 그 캘린더를 지운다
//   켠 동안: 상태 줄(마지막으로 맞춘 시각, 일정 수), 넣을 팀(기본 전부, 이 기기에만 저장), 한쪽으로만 보낸다는 안내
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { Button, ErrorState, RowGroup, Skeleton, ToggleRow } from "@/components/ui";
import { messageOf, useGroups, useMe } from "@/hooks";
import { appSupportsDeviceCalendar, isInApp, postToApp } from "@/lib/app-bridge";
import {
  CALENDAR_STATUS_EVENT,
  parseCalendarSettings,
  rawCalendarSettings,
  requestCalendar,
  subscribeCalendarSettings,
  statusLine,
  writeCalendarSettings,
  type CalendarSettings,
  type CalendarStatus,
} from "@/lib/device-calendar";

const noop = () => () => {};

/** 앱 셸이고 휴대폰 캘린더를 아는지 (서버 렌더는 false) */
export function useDeviceCalendarSupported(): boolean {
  return useSyncExternalStore(
    noop,
    () => isInApp() && appSupportsDeviceCalendar(navigator.userAgent),
    () => false,
  );
}

export function DeviceCalendarScreen() {
  const toast = useToast();
  const supported = useDeviceCalendarSupported();
  const meQ = useMe();
  const groupsQ = useGroups();
  const me = meQ.data;
  const groups = groupsQ.data?.filter((g) => !g.hidden) ?? null;
  const [reply, setReply] = useState<{ status: CalendarStatus | null; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const status = reply?.status ?? null;
  const checked = reply !== null;

  // 설정은 사용자를 안 뒤에 읽는다 (같은 기기 다른 계정의 설정을 쓰지 않게). 이 기기 localStorage 를 지켜본다
  const meId = me?.id ?? null;
  const raw = useSyncExternalStore(subscribeCalendarSettings, rawCalendarSettings, () => null);
  const settings = useMemo<CalendarSettings | null>(() => (meId === null ? null : parseCalendarSettings(raw, meId)), [raw, meId]);

  // 처음 그릴 때, 기기 설정에서 돌아올 때 다시 읽는다. 맞추기가 끝나면 useDeviceCalendarSync 가 받은 상태도 여기로 온다
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    const load = () =>
      requestCalendar({ type: "calendarSyncStatus" }).then((s) => {
        if (alive) setReply({ status: s, at: Date.now() });
      });
    void load();
    const onStatus = (e: Event) => setReply({ status: (e as CustomEvent<CalendarStatus>).detail, at: Date.now() });
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener(CALENDAR_STATUS_EVENT, onStatus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener(CALENDAR_STATUS_EVENT, onStatus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [supported]);

  // 셸이 답한 켜짐 여부를 이 기기 설정에 비춘다 (로그아웃으로 셸이 캘린더를 지웠거나, 기기 설정에서 권한을 끈 경우)
  useEffect(() => {
    if (settings && status && status.enabled !== settings.enabled) writeCalendarSettings({ ...settings, enabled: status.enabled });
  }, [settings, status]);

  async function toggle(on: boolean) {
    if (!settings || busy) return;
    setBusy(true);
    const s = await requestCalendar({ type: on ? "calendarSyncEnable" : "calendarSyncDisable" });
    setBusy(false);
    if (!s) {
      toast.show(on ? "켜지 못했어요. 다시 시도해 주세요" : "끄지 못했어요. 다시 시도해 주세요");
      return;
    }
    setReply({ status: s, at: Date.now() });
    // 켜졌으면 useDeviceCalendarSync 가 이 이벤트를 받아 바로 맞춘다
    writeCalendarSettings({ ...settings, enabled: s.enabled });
    if (on && !s.enabled && s.permission === "granted") toast.show("휴대폰 캘린더를 만들지 못했어요. 다시 시도해 주세요");
  }

  function pickTeam(id: number, on: boolean) {
    if (!settings || !groups) return;
    const all = groups.map((g) => g.id);
    const current = settings.teams === null ? all : settings.teams.filter((t) => all.includes(t));
    const nextList = on ? [...new Set([...current, id])] : current.filter((t) => t !== id);
    if (nextList.length === 0) {
      toast.show("팀을 하나 이상 골라 주세요");
      return;
    }
    // 전부 고르면 null (나중에 생기는 팀도 들어간다)
    const teams = all.every((t) => nextList.includes(t)) ? null : nextList;
    writeCalendarSettings({ ...settings, teams });
  }

  const enabled = settings?.enabled === true && status?.enabled === true;
  const denied = status?.permission === "denied";
  const failure = meQ.error ?? groupsQ.error;

  let body: React.ReactNode;
  if (!supported) {
    body = <p className="rounded-xl bg-paper px-3.5 py-3 text-[14px] leading-5 text-soft">휴대폰 캘린더는 언제볼까 앱 1.3.0 이상에서 쓸 수 있어요. 앱을 업데이트해 주세요</p>;
  } else if (failure && !me) {
    body = <ErrorState message={messageOf(failure, "내 정보를 불러오지 못했어요")} onRetry={meQ.refetch} />;
  } else {
    body = (
      <div className="space-y-5">
        <section className="rounded-xl bg-paper px-3.5 py-1">
          {settings && checked ? (
            <ToggleRow
              label="휴대폰 캘린더에 표시"
              description="고른 팀 일정을 휴대폰 캘린더에 넣어요"
              checked={enabled}
              disabled={busy}
              onChange={(v) => void toggle(v)}
            />
          ) : (
            <div className="flex min-h-12 items-center justify-between py-2">
              <span>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1.5 h-3 w-52" />
              </span>
              <Skeleton className="h-6 w-10 rounded-full" />
            </div>
          )}
          {checked && !status && <p className="t-sub pb-2.5">상태를 확인하지 못했어요</p>}
          {enabled && status && (
            <p role="status" className="t-sub pb-2.5">
              {statusLine(status, reply?.at ?? 0)}
            </p>
          )}
          {!enabled && denied && (
            <div className="flex items-center gap-2 pb-2.5">
              <p className="t-sub min-w-0 flex-1">캘린더 접근이 꺼져 있어요. 기기 설정에서 언제볼까의 캘린더 접근을 켜 주세요</p>
              <Button size="sm" variant="secondary" onClick={() => postToApp({ type: "openSettings" })}>
                설정 열기
              </Button>
            </div>
          )}
        </section>

        {enabled && (
          <RowGroup title="넣을 팀" hint="이 기기에만 저장돼요. 전부 골라 두면 나중에 들어간 팀도 함께 들어가요">
            {groups && settings
              ? groups.map((g) => (
                  <ToggleRow
                    key={g.id}
                    label={g.name}
                    description={g.type === "PERSONAL" ? "개인 달력" : `${g.memberCount}명`}
                    checked={settings.teams === null || settings.teams.includes(g.id)}
                    onChange={(v) => pickTeam(g.id, v)}
                  />
                ))
              : [0, 1].map((i) => <Skeleton key={i} className="my-3 h-5 w-full" />)}
          </RowGroup>
        )}

        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-5 text-ink-2">
          <li>지난 30일부터 앞으로 180일까지의 일정이 들어가요. 반복 일정은 날마다 하나씩 들어가요</li>
          <li>한쪽으로만 보내요. 휴대폰 캘린더에서 고치거나 지운 내용은 언제볼까에 반영되지 않고, 다음에 맞출 때 언제볼까 내용으로 돌아가요</li>
          <li>제목, 시간, 장소, 참여자 이름이 들어가고 메모는 넣지 않아요</li>
          <li>앱을 열 때와 일정을 바꿀 때 맞춰요. 끄거나 로그아웃하면 휴대폰의 언제볼까 캘린더를 지워요</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="fold:max-w-[480px]">
      <ScreenHeader title="휴대폰 캘린더" fallbackHref="/me" backLabel="내 정보로" />
      <div className="mt-3">{body}</div>
    </div>
  );
}
