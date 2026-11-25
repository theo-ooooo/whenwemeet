"use client";
// (#188) 내 정보 > 알림 (푸시-알림.md 8장, 7-1).
//   맨 위 "이 기기": 푸시 지원 앱이면 권한 상태(받는 중 + [설정 열기] / 등록하지 못함 + [다시 시도] / [알림 받기] / 꺼져 있어요 + [설정 열기]), 웹과 1.0.x 앱은 안내 한 줄
//   토글 6개: 계정 단위라 다른 기기에도 적용. 누르면 바로 저장, 실패하면 되돌리고 토스트
//   (#277) "주간 요약"(기본 켬), "다 같이 비는 시간"(조용한 팀 깨우기, 기본 끔 D-204)
//   (#528) 맨 아래 "공지"(기본 켬, D-287). 팀과 무관한 운영 공지라 팀 설정의 "이 팀 알림 받기" 와 상관없다
//   (#378) 팀 화면 뼈대(AppShell) 안이라 다른 화면과 같은 앱 머리줄이 있다. 머리줄 "‹ 알림", 토글은 설정 줄(ToggleRow) + 설명 한 줄.
//   "알림은 앱에서 받을 수 있어요" 는 웹 브라우저에서만 (usePushNote: 앱이면 null 또는 업데이트 안내)
import { useCallback, useState, useSyncExternalStore } from "react";
import { usePushNote } from "@/components/ReminderPicker";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { Button, ErrorState, RowGroup, Skeleton, ToggleRow } from "@/components/ui";
import { messageOf, useNotificationSettings, useUpdateNotificationSettings } from "@/hooks";
import { appSupportsPush, openAppSettings, requestPushStatus, type PushStatus } from "@/lib/app-bridge";
import { canAskPermission, recordPrompt } from "@/lib/push";
import { usePushRegistrar, usePushSync } from "@/lib/usePushSync";
import { NOTIFICATION_KINDS as KINDS } from "@/lib/notification-kinds";
import type { NotificationSettings } from "@/lib/types";


const noop = () => () => {};

/** 이 기기 줄 (푸시 지원 앱에서만) */
function DeviceRow() {
  const apply = usePushRegistrar();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [asking, setAsking] = useState(false);
  const onStatus = useCallback((s: PushStatus | null) => {
    setStatus(s);
    setChecked(true);
  }, []);
  // 처음 그릴 때와 설정 앱에서 돌아올 때 다시 읽는다 (등록, 정리도 함께)
  usePushSync(onStatus);

  async function ask() {
    // 여기서 직접 켰으면 안내 시트는 다시 띄우지 않는다
    recordPrompt("accepted");
    setAsking(true);
    const s = await requestPushStatus("request");
    if (s) setStatus(s);
    await apply(s);
    setAsking(false);
  }

  async function retry() {
    setAsking(true);
    const s = await requestPushStatus("status");
    if (s) setStatus(s);
    await apply(s);
    setAsking(false);
  }

  let body: React.ReactNode;
  if (!checked) {
    body = <Skeleton className="h-5 w-24" />;
  } else if (!status) {
    body = <span className="text-[13px] text-ink-2">상태를 확인하지 못했어요</span>;
  } else if (status.permission === "granted" && status.token) {
    // (#294) 앱은 OS 권한을 끌 수 없어 기기 설정으로 보낸다. 끄고 돌아오면 usePushSync 가 다시 읽어 서버 등록을 지운다
    body = (
      <span className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-acc-ink">알림 받는 중</span>
        <Button size="sm" variant="secondary" onClick={() => openAppSettings()}>
          설정 열기
        </Button>
      </span>
    );
  } else if (status.permission === "granted") {
    // (#288) OS 는 허용인데 토큰을 못 받았다(첫 발급 지연, 네트워크). 받는 중이라고 하지 않는다
    body = (
      <span className="flex items-center gap-2">
        <span className="text-[13px] text-ink-2">기기를 등록하지 못했어요</span>
        <Button size="sm" variant="secondary" loading={asking} onClick={() => void retry()}>
          다시 시도
        </Button>
      </span>
    );
  } else if (canAskPermission(status.permission, status.canAskAgain)) {
    body = (
      <Button size="sm" loading={asking} onClick={() => void ask()}>
        알림 받기
      </Button>
    );
  } else {
    body = (
      <span className="flex items-center gap-2">
        <span className="text-[13px] text-ink-2">꺼져 있어요</span>
        <Button size="sm" variant="secondary" onClick={() => openAppSettings()}>
          설정 열기
        </Button>
      </span>
    );
  }

  return (
    <section className="rounded-xl bg-paper px-3.5 py-1">
      <div className="flex min-h-12 items-center gap-3 py-1">
        <span className="shrink-0 text-[14px] font-semibold">이 기기</span>
        <span className="ml-auto flex min-w-0 items-center justify-end">{body}</span>
      </div>
      {checked && status?.permission === "denied" && !canAskPermission(status.permission, status.canAskAgain) && (
        <p className="t-sub pb-2.5">기기 설정에서 언제볼까 알림을 켜 주세요</p>
      )}
      {checked && status?.permission === "granted" && status.token && (
        <p className="t-sub pb-2.5">이 기기에서 그만 받으려면 기기 설정에서 언제볼까 알림을 꺼 주세요</p>
      )}
    </section>
  );
}

export function NotificationSettingsScreen() {
  const toast = useToast();
  const settingsQ = useNotificationSettings();
  const { mutate } = useUpdateNotificationSettings();
  const settings = settingsQ.data;
  const setSettings = settingsQ.setData;
  const supported = useSyncExternalStore(noop, appSupportsPush, () => false);
  const note = usePushNote();
  const [saving, setSaving] = useState<keyof NotificationSettings | null>(null);

  async function toggle(key: keyof NotificationSettings, value: boolean) {
    if (!settings || saving) return;
    const before = settings;
    // 바로 바꿔 보이고, 실패하면 되돌린다 (8장)
    setSettings({ ...before, [key]: value });
    setSaving(key);
    const r = await mutate({ [key]: value });
    setSaving(null);
    if (r.ok) {
      setSettings(r.data);
      return;
    }
    setSettings(before);
    toast.show(messageOf(r.error, "알림 설정을 바꾸지 못했어요. 다시 시도해 주세요"));
  }

  // 본문 폭 main-lg(≥696): 2단(왼쪽 이 기기, 오른쪽 받을 알림)
  return (
    <div>
      <ScreenHeader title="알림" fallbackHref="/me" backLabel="내 정보로" />

      <div className="mt-3 space-y-5 main-lg:grid main-lg:grid-cols-2 main-lg:items-start main-lg:gap-3 main-lg:space-y-0">
        <div>
          {supported ? (
            <DeviceRow />
          ) : (
            note && <p className="rounded-xl bg-paper px-3.5 py-3 text-[14px] leading-5 text-soft">{note}</p>
          )}
        </div>
        {settingsQ.error && !settings ? (
          <ErrorState message={messageOf(settingsQ.error, "알림 설정을 불러오지 못했어요")} onRetry={settingsQ.refetch} />
        ) : (
          <div aria-busy={!settings || undefined}>
            <RowGroup title="받을 알림" hint="내 계정의 모든 기기에 적용돼요. 팀별로는 팀 설정에서 꺼요">
              {KINDS.map((k) =>
                settings ? (
                  <ToggleRow key={k.key} checked={settings[k.key]} onChange={(v) => void toggle(k.key, v)} label={k.label} description={k.description} />
                ) : (
                  <div key={k.key} className="flex min-h-11 items-center justify-between py-1">
                    <span>
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="mt-1.5 h-3 w-44" />
                    </span>
                    <Skeleton className="h-6 w-10 rounded-full" />
                  </div>
                ),
              )}
            </RowGroup>
          </div>
        )}
      </div>
    </div>
  );
}
