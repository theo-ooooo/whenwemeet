"use client";
// (#188) 내 정보 > 알림 (푸시-알림.md 8장, 7-1).
//   맨 위 "이 기기": 푸시 지원 앱이면 권한 상태(받는 중 / [알림 받기] / 꺼져 있어요 + [설정 열기]), 웹과 1.0.x 앱은 안내 한 줄
//   토글 4개: 계정 단위라 다른 기기에도 적용. 누르면 바로 저장, 실패하면 되돌리고 토스트
import { useRouter } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import { usePushNote } from "@/components/ReminderPicker";
import { useToast } from "@/components/Toast";
import { Button, ErrorState, Skeleton, Toggle } from "@/components/ui";
import { messageOf, useNotificationSettings, useUpdateNotificationSettings } from "@/hooks";
import { appSupportsPush, openAppSettings, requestPushStatus, type PushStatus } from "@/lib/app-bridge";
import { recordPrompt } from "@/lib/push";
import { usePushRegistrar, usePushSync } from "@/lib/usePushSync";
import type { NotificationSettings } from "@/lib/types";

const KINDS: { key: keyof NotificationSettings; label: string; description: string }[] = [
  { key: "reminder", label: "일정 알림", description: "일정에 고른 시각에 알려 드려요" },
  { key: "change", label: "팀원 변경", description: "팀원이 일정을 추가, 수정, 삭제하면 알려 드려요" },
  { key: "anniversary", label: "기념일 당일", description: "기념일 아침 9시에 알려 드려요" },
  { key: "join", label: "새 멤버 합류", description: "초대한 사람이 팀에 들어오면 알려 드려요" },
];

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

  let body: React.ReactNode;
  if (!checked) {
    body = <Skeleton className="h-5 w-24" />;
  } else if (!status) {
    body = <span className="text-[13px] text-ink-2">상태를 확인하지 못했어요</span>;
  } else if (status.permission === "granted") {
    body = <span className="text-[13px] font-semibold text-acc-ink">알림 받는 중</span>;
  } else if (status.permission === "undetermined") {
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
    <section className="mt-3 rounded-xl bg-paper px-3.5 py-1">
      <div className="flex min-h-12 items-center gap-3 py-1">
        <span className="shrink-0 text-[14px] font-semibold">이 기기</span>
        <span className="ml-auto flex min-w-0 items-center justify-end">{body}</span>
      </div>
      {checked && status?.permission === "denied" && (
        <p className="t-sub pb-2.5">기기 설정에서 언제볼까 알림을 켜 주세요</p>
      )}
    </section>
  );
}

export function NotificationSettingsScreen() {
  const router = useRouter();
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

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] lg:pt-6">
      <div className="mt-2 flex h-10 items-center justify-between lg:mt-0">
        <h1 className="t-title">알림</h1>
        <button type="button" onClick={() => router.back()} className="hit h-8 rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95">
          뒤로
        </button>
      </div>

      {supported ? (
        <DeviceRow />
      ) : (
        note && (
          <section className="mt-3 rounded-xl bg-paper px-3.5 py-3">
            <p className="text-[14px] leading-5 text-soft">{note}</p>
          </section>
        )
      )}

      {settingsQ.error && !settings ? (
        <div className="mt-2">
          <ErrorState message={messageOf(settingsQ.error, "알림 설정을 불러오지 못했어요")} onRetry={settingsQ.refetch} />
        </div>
      ) : (
        <section className="mt-2 rounded-xl bg-paper px-3.5 py-1.5" aria-busy={!settings || undefined}>
          <h2 className="pt-1.5 text-[13px] font-bold leading-5">받을 알림</h2>
          <ul className="divide-y divide-line">
            {KINDS.map((k) => (
              <li key={k.key} className="py-1">
                {settings ? (
                  <Toggle checked={settings[k.key]} onChange={(v) => void toggle(k.key, v)} label={k.label} description={k.description} />
                ) : (
                  <div className="flex min-h-11 items-center justify-between py-1">
                    <span>
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="mt-1.5 h-3 w-44" />
                    </span>
                    <Skeleton className="h-6 w-10 rounded-full" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="t-sub mt-2 px-1">이 설정은 내 계정의 모든 기기에 적용돼요. 팀별로 끄려면 팀 설정에서 바꿔 주세요</p>
    </main>
  );
}
