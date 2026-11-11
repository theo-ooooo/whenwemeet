"use client";
// (#188) 일정 알림 시각 고르기 (푸시-알림.md 4-1, 8장). 선택지는 종일 여부로 갈린다 (lib/reminder.ts)
//   ReminderSheet:   일정 폼의 "알림" 줄을 누르면 뜨는 목록 (반복 시트와 같은 모양)
//   ReminderInline:  빠른 추가처럼 이미 시트 안인 곳에서 줄 아래로 펼치는 목록
//   ReminderNote:    푸시를 받을 수 없는 곳(웹, 1.0.x 앱) 의 안내 한 줄
import { useSyncExternalStore } from "react";
import { IconCheck } from "./icons";
import { Sheet } from "./ui";
import { pushSupport, type PushSupport } from "@/lib/app-bridge";
import { REMINDER_LABEL, reminderOptions } from "@/lib/reminder";
import type { EventReminder } from "@/lib/types";

function Options({ allDay, value, onPick, compact = false }: { allDay: boolean; value: EventReminder; onPick: (v: EventReminder) => void; compact?: boolean }) {
  return (
    <ul role="radiogroup" aria-label="알림" className="pb-1">
      {reminderOptions(allDay).map((r) => {
        const on = r === value;
        return (
          <li key={r}>
            <button
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(r)}
              className={`flex w-full items-center gap-3 rounded-md px-3 text-left hover:bg-hover ${compact ? "h-10 text-[14px]" : "h-12 text-[15px]"} ${on ? "font-bold" : "font-medium"}`}
            >
              <span className="min-w-0 flex-1 truncate">{REMINDER_LABEL[r]}</span>
              {on && <IconCheck size={18} className="shrink-0 text-acc-ink" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ReminderSheet({
  open,
  allDay,
  value,
  onPick,
  onClose,
}: {
  open: boolean;
  allDay: boolean;
  value: EventReminder;
  onPick: (v: EventReminder) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="알림">
      <Options allDay={allDay} value={value} onPick={onPick} />
    </Sheet>
  );
}

export function ReminderInline({ allDay, value, onPick }: { allDay: boolean; value: EventReminder; onPick: (v: EventReminder) => void }) {
  return (
    <div className="mt-1 rounded-sm border border-line p-1">
      <Options allDay={allDay} value={value} onPick={onPick} compact />
    </div>
  );
}

const noop = () => () => {};
const NOTE: Record<PushSupport, string | null> = {
  supported: null,
  web: "알림은 앱에서 받을 수 있어요",
  updateApp: "앱을 업데이트하면 알림을 받을 수 있어요",
};

/** 이 기기에서 알림을 못 받는 이유 한 줄. 받을 수 있는 앱이면 null. 서버 렌더에서는 그리지 않는다 (앱 판정은 브라우저에서만) */
export function usePushNote(): string | null {
  const support = useSyncExternalStore(noop, pushSupport, () => null);
  return support ? NOTE[support] : null;
}

export function ReminderNote({ className = "" }: { className?: string }) {
  const note = usePushNote();
  if (!note) return null;
  return <p className={`t-sub ${className}`}>{note}</p>;
}
