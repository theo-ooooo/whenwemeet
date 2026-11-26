"use client";
// (#549) 내 정보 > 휴대폰 캘린더 (docs/설계/앱.md 4.9, D-294). 휴대폰 캘린더를 아는 앱 셸(UA 에 DeviceCalendar/1)에서만 내 정보에 줄이 보인다.
//   "휴대폰 캘린더에 표시" 스위치: 켜면 셸이 캘린더 권한을 묻고 "언제볼까" 캘린더를 만든다. 끄면 그 캘린더를 지운다
//   켠 동안: 상태 줄(마지막으로 맞춘 시각, 일정 수), 넣을 팀(기본 전부, 이 기기에만 저장), 한쪽으로만 보낸다는 안내
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { IconArrowRight, IconCalendar, IconRepeat, IconShield } from "@/components/icons";
import { Button, ErrorState, RowGroup, Skeleton, ToggleRow } from "@/components/ui";
import { SwitchTrack } from "@/components/ui/SwitchTrack";
import { messageOf, useGroups, useMe } from "@/hooks";
import { appSupportsDeviceCalendar, isInApp, postToApp } from "@/lib/app-bridge";
import {
  CALENDAR_STATUS_EVENT,
  parseCalendarSettings,
  rawCalendarSettings,
  requestCalendar,
  subscribeCalendarSettings,
  statusLine,
  syncedAtText,
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
        {/* 큰 스위치 카드: 아이콘, 제목, 두 줄까지 보이는 설명, 스위치. 켜면 아래에 맞춘 시각과 일정 수 */}
        <section className="rounded-2xl bg-paper p-4">
          {settings && checked ? (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={busy}
              onClick={() => void toggle(!enabled)}
              className="flex w-full items-center gap-3 text-left disabled:opacity-45"
            >
              <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface text-acc-ink">
                <IconCalendar size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-bold">휴대폰 캘린더에 표시</span>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-soft">아이폰, 갤럭시 기본 캘린더에서도 언제볼까 일정을 볼 수 있어요</span>
              </span>
              <SwitchTrack checked={enabled} />
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 rounded-xl" />
              <span className="flex-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="mt-1.5 h-3 w-56" />
              </span>
              <Skeleton className="h-6 w-10 rounded-full" />
            </div>
          )}
          {checked && !status && <p className="t-sub mt-3">상태를 확인하지 못했어요</p>}
          {enabled && status && (
            <div role="status" className="mt-4 border-t border-line pt-3">
              {status.failed || !status.lastSyncedAt ? (
                <p className="t-sub">{statusLine(status, reply?.at ?? 0)}</p>
              ) : (
                <dl className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-surface px-3 py-2.5">
                    <dt className="text-[12px] text-ink-2">마지막으로 맞춤</dt>
                    <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{syncedAtText(status.lastSyncedAt, reply?.at ?? 0)}</dd>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-2.5">
                    <dt className="text-[12px] text-ink-2">넣은 일정</dt>
                    <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{status.count}개</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
          {!enabled && denied && (
            <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
              <p className="t-sub min-w-0 flex-1">캘린더 접근이 꺼져 있어요. 기기 설정에서 켜 주세요</p>
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

        {/* 알아 둘 것: 긴 글 대신 아이콘 줄 셋 */}
        <RowGroup title="알아 두세요">
          {[
            { icon: <IconRepeat size={18} />, title: "지난 30일부터 앞으로 180일까지", sub: "반복 일정은 날마다 하나씩 들어가요" },
            { icon: <IconArrowRight size={18} />, title: "언제볼까에서 휴대폰으로만 보내요", sub: "휴대폰 캘린더에서 고친 내용은 다음에 맞출 때 되돌아가요" },
            { icon: <IconShield size={18} />, title: "메모는 넣지 않아요", sub: "끄거나 로그아웃하면 휴대폰의 언제볼까 캘린더를 지워요" },
          ].map((n) => (
            <div key={n.title} className="flex items-start gap-3 py-3">
              <span aria-hidden="true" className="mt-0.5 text-ink-2">
                {n.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">{n.title}</span>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-soft">{n.sub}</span>
              </span>
            </div>
          ))}
        </RowGroup>
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
