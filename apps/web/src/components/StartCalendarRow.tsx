"use client";
// (#300) 내 정보 > "처음 여는 달력" 한 줄과 고르기 시트 (D-191).
// 줄 모양은 같은 화면의 "알림" 줄, 시트 목록은 알림 시각 시트(ReminderPicker)와 같은 라디오 목록.
// 고르면 바로 저장하고 시트를 닫은 뒤 토스트. 실패하면 시트를 열어 둔 채 토스트로 알린다
import { useState } from "react";
import { IconCalendar, IconCheck, IconChevronRight } from "./icons";
import { useToast } from "./Toast";
import { Sheet } from "./ui";
import { messageOf, useUpdateStartCalendar } from "@/hooks";
import { START_LAST, START_MODE_LABEL, startCalendarLabel } from "@/lib/start-calendar";
import type { GroupSummary, StartCalendar } from "@/lib/types";

type Option = { key: string; label: string; value: StartCalendar };

/** 마지막에 본 달력, 내 달력, 그다음 내 팀(개인 팀 빼고) 순서 */
function optionsOf(groups: GroupSummary[]): Option[] {
  return [
    { key: "LAST", label: START_MODE_LABEL.LAST, value: START_LAST },
    { key: "PERSONAL", label: START_MODE_LABEL.PERSONAL, value: { mode: "PERSONAL", groupId: null } },
    ...groups.filter((g) => g.type === "TEAM").map((g) => ({ key: `G${g.id}`, label: g.name, value: { mode: "GROUP" as const, groupId: g.id } })),
  ];
}

/** 지금 값과 같은 선택지인지. GROUP 인데 목록에 없는 팀이면 LAST 에 표시 */
function isCurrent(option: StartCalendar, current: StartCalendar, groups: GroupSummary[]): boolean {
  if (current.mode === "GROUP" && !groups.some((g) => g.id === current.groupId)) return option.mode === "LAST";
  return option.mode === current.mode && option.groupId === current.groupId;
}

export function StartCalendarRow({
  value,
  groups,
  onChange,
}: {
  /** GET /me 의 startCalendar. 아직 못 받았으면 undefined */
  value: StartCalendar | undefined;
  groups: GroupSummary[] | null;
  onChange: (next: StartCalendar) => void;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { mutate, isPending } = useUpdateStartCalendar();
  const ready = value !== undefined && groups !== null;

  async function pick(next: StartCalendar) {
    if (!ready || isPending) return;
    if (isCurrent(next, value, groups)) {
      setOpen(false);
      return;
    }
    const r = await mutate(next);
    if (!r.ok) {
      toast.show(messageOf(r.error, "처음 여는 달력을 바꾸지 못했어요. 다시 시도해 주세요"));
      return;
    }
    onChange(r.data);
    setOpen(false);
    toast.show("처음 여는 달력을 바꿨어요");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!ready}
        aria-haspopup="dialog"
        className="mt-2 flex min-h-12 w-full items-center gap-2.5 rounded-xl bg-paper px-3.5 py-2 text-left hover:brightness-95 disabled:cursor-default"
      >
        <IconCalendar size={18} className="shrink-0 text-ink-2" />
        <span className="shrink-0 text-[15px] font-semibold">처음 여는 달력</span>
        <span className="min-w-0 flex-1 truncate text-right text-[13px] text-ink-2">{ready ? startCalendarLabel(value, groups) : ""}</span>
        <IconChevronRight size={14} className="shrink-0 text-ink-2" />
      </button>

      {ready && (
        <Sheet open={open} onClose={() => setOpen(false)} title="처음 여는 달력">
          <p className="t-sub mb-1 px-3">앱이나 웹을 열 때 먼저 보여줄 달력이에요</p>
          <ul role="radiogroup" aria-label="처음 여는 달력" aria-busy={isPending} className="pb-1">
            {optionsOf(groups).map((o) => {
              const on = isCurrent(o.value, value, groups);
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={isPending}
                    onClick={() => pick(o.value)}
                    className={`flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] hover:bg-hover disabled:cursor-wait ${on ? "font-bold" : "font-medium"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {on && <IconCheck size={18} className="shrink-0 text-acc-ink" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}
    </>
  );
}
