"use client";
// (#378) 기념일, 생일 알림 줄 "알림 (오전 9시) ··· 당일 ›". 누르면 시점 목록(여러 개 고르기)을 피커 틀(폰 바텀 시트, 넓은 화면 팝오버)로 연다.
// 고르는 규칙은 예전 칩과 같다(lib/anniversary-reminder): 당일, 하루 전, 일주일 전은 켜고 끄기, "없음" 은 셋을 끈다.
// 고를 때마다 바로 반영하고, 닫기(✕, 바깥, Esc, 완료)로 닫는다. 이 기기에서 알림을 못 받으면(웹 등) 목록 아래 한 줄 안내
import { useRef, useState } from "react";
import { IconBell, IconCheck, IconChevronRight } from "./icons";
import { PickerShell, triggerClassOf } from "./pickers/PickerShell";
import { ReminderNote } from "./ReminderPicker";
import { Button, RowIcon } from "./ui";
import { REMINDER_CHOICES, isChoiceOn, reminderSummary, toggleReminder } from "@/lib/anniversary-reminder";
import type { AnniversaryReminder } from "@/lib/types";

export function ReminderChoicesRow({
  label,
  value,
  onChange,
}: {
  /** 줄 이름 (예: "알림", "팀원에게 알림"). 뒤에 "(오전 9시)" 가 붙는다 */
  label: string;
  value: readonly AnniversaryReminder[];
  onChange: (next: AnniversaryReminder[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const summary = reminderSummary(value);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} 오전 9시, ${summary}`}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassOf("row")}
      >
        <RowIcon>
          <IconBell size={18} />
        </RowIcon>
        <span className="shrink-0 text-[14px] font-semibold">
          {label} <span className="font-normal text-ink-2">(오전 9시)</span>
        </span>
        <span className="ml-auto min-w-0 truncate text-[14px] text-ink-2">{summary}</span>
        <IconChevronRight size={16} className="-mr-1 shrink-0 text-ink-2" />
      </button>
      <PickerShell open={open} onClose={() => setOpen(false)} trigger={btn} title={label} width={280}>
        <ul role="group" aria-label={`${label} 시점`} className="pb-1">
          {REMINDER_CHOICES.map((c) => {
            const on = isChoiceOn(value, c.value);
            return (
              <li key={c.value}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(toggleReminder(value, c.value))}
                  className={`flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] hover:bg-hover ${on ? "font-bold" : "font-medium"}`}
                >
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {on && <IconCheck size={18} className="shrink-0 text-acc-ink" />}
                </button>
              </li>
            );
          })}
        </ul>
        <ReminderNote className="px-3 pb-2" />
        <Button variant="secondary" size="lg" full onClick={() => setOpen(false)}>
          완료
        </Button>
      </PickerShell>
    </>
  );
}
