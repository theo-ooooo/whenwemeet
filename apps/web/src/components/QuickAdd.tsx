"use client";
// 달력에서 바로 일정 추가 (#46). 폴더블.md 5-2 부터는 날짜 상세(DayPanel) 의 "이 날 일정 추가" 가 같은 자리에서 이 폼으로 바뀐다.
// 날짜 칸을 누르면 바로 열리던 경로(모바일 재탭, PC 빈 곳 클릭)는 없앴다. 바로 추가는 + 버튼이 맡는다.
// 필드: 제목, 종일, 시작/종료 시각. 저장은 useCreateEvent, "자세히" 는 새 일정 폼으로 값을 넘긴다.
import { useRouter } from "next/navigation";
import { newEventHref } from "@/lib/routes";
import { useId, useState } from "react";
import { IconChevronLeft, IconClose } from "./icons";
import { TimeList, TimePicker } from "./pickers";
import { ReminderInline, ReminderNote } from "./ReminderPicker";
import { minutesOf, timeOfMinutes } from "./pickers/time";
import { Button, Toggle, titleInputClass } from "./ui";
import { messageOf, useCreateEvent } from "@/hooks";
import { haptic } from "@/lib/app-bridge";
import { maybeOpenPushPrompt } from "@/lib/push";
import { REMINDER_LABEL, reminderAfterAllDayChange, reminderToSend } from "@/lib/reminder";
import { clampChars } from "@/lib/chars";
import { addDays, dowOf, kstToIso, parseKey, WEEKDAYS, type DateKey } from "@/lib/date";
import type { Event, EventReminder } from "@/lib/types";

type GroupId = Event["groupId"];

type Props = {
  groupId: GroupId;
  date: DateKey;
  titleId: string;
  onClose: () => void;
  /** ← : 날짜 상세로 */
  onBack: () => void;
  /** 저장 성공. 화면은 목록을 다시 받아 바로 보여준다 */
  onSaved: (ev: Event) => void;
};

/* ---------- 폼 (시트, 팝오버 공통) ---------- */

export function QuickAddForm({ groupId, date, onClose, onBack, onSaved, titleId }: Props) {
  const router = useRouter();
  const ids = useId();
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [timeOpen, setTimeOpen] = useState<"start" | "end" | null>(null);
  // 알림 (#188, 8장 "빠른 추가 시트 포함"). 시트 안이라 줄 아래로 펼친다
  const [reminder, setReminder] = useState<EventReminder>("NONE");
  const [reminderOpen, setReminderOpen] = useState(false);
  // 펼친 시각 목록을 닫으면 포커스를 그 시각 버튼으로 돌린다
  function closeTime() {
    if (timeOpen) document.getElementById(`${ids}-${timeOpen}`)?.focus({ preventScroll: true });
    setTimeOpen(null);
  }
  const [touched, setTouched] = useState(false);
  const create = useCreateEvent(groupId);

  const titleError = touched && title.trim().length === 0 ? "제목을 입력해 주세요" : null;
  const rangeError = !allDay && (!start || !end || (minutesOf(end) ?? 0) <= (minutesOf(start) ?? 0)) ? "종료는 시작보다 뒤여야 해요" : null;
  const saveError = create.error ? messageOf(create.error, "저장하지 못했어요. 다시 저장해 주세요") : null;

  const startsAt = allDay ? kstToIso(date) : kstToIso(date, start || "00:00");
  const endsAt = allDay ? kstToIso(addDays(date, 1)) : kstToIso(date, end || "00:00");

  function changeStart(v: string) {
    // 시작을 바꾸면 길이(기본 1시간)를 유지하게 종료를 같이 민다. 하루 안에서만 잡으므로 자정(24:00) 에서 멈춘다
    const s0 = minutesOf(start);
    const e0 = minutesOf(end);
    const len = s0 !== null && e0 !== null && e0 > s0 ? e0 - s0 : 60;
    setStart(v);
    const s = minutesOf(v);
    if (s === null) return;
    setEnd(timeOfMinutes(Math.min(s + len, 24 * 60)));
  }

  function changeEnd(v: string) {
    // 종료가 시작보다 앞서면 시작 1시간 뒤(자정까지) 로 맞춘다 (#67)
    const s = minutesOf(start);
    const e = minutesOf(v);
    if (s !== null && e !== null && e <= s) {
      setEnd(timeOfMinutes(Math.min(s + 60, 24 * 60)));
      return;
    }
    setEnd(v);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (title.trim().length === 0 || rangeError || create.isPending) return;
    const sent = reminderToSend(reminder, null);
    const r = await create.mutate({ title: title.trim(), startsAt, endsAt, allDay, ...(sent ? { reminder: sent } : {}) });
    if (r.ok) {
      haptic("success");
      // 권한 안내 시트 계기 ① 일정 저장 성공 직후 (8-1)
      void maybeOpenPushPrompt();
      onSaved(r.data);
    }
  }

  function more() {
    // 종일이어도 시각은 그대로 넘긴다. 폼에서 종일을 끄면 그 시각이 보인다
    const q = new URLSearchParams({ start: kstToIso(date, start || "10:00"), end: kstToIso(date, end || "11:00") });
    if (title.trim()) q.set("title", title.trim());
    if (allDay) q.set("allDay", "1");
    if (reminder !== "NONE") q.set("reminder", reminder);
    router.push(newEventHref(q));
  }

  return (
    <form onSubmit={save} noValidate>
      {/* 머리: "← 12일 목요일에 추가" + 닫기 (폴더블.md 5-2). 뒤로 화살표 선을 시트 여백 16 에 맞춘다(광학 정렬, 일정 상세와 같음). 버튼 칸은 왼쪽으로 내밀고 누르는 영역 44 는 hit 가 유지 (#174 L9) */}
      <div data-drag className="flex h-10 touch-none items-center gap-1">
        <button type="button" onClick={onBack} aria-label="날짜 상세로" className="hit -ml-2 flex size-8 shrink-0 items-center rounded-sm pl-0.5 text-ink-2 hover:bg-hover hover:text-ink">
          <IconChevronLeft size={18} />
        </button>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-[18px] font-bold leading-6 tracking-[-0.02em]">
          {parseKey(date).d}일 {WEEKDAYS[dowOf(date)]}요일에 추가
        </h2>
        <button type="button" onClick={onClose} aria-label="닫기" className="hit grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink">
          <IconClose size={18} />
        </button>
      </div>

      <label htmlFor={`${ids}-title`} className="sr-only">
        제목
      </label>
      <input
        id={`${ids}-title`}
        autoFocus
        className={`${titleInputClass} mt-2`}
        placeholder="무슨 일정인가요?"
        value={title}
        onChange={(e) => setTitle(clampChars(e.target.value, 50))}
        aria-invalid={Boolean(titleError)}
        aria-describedby={titleError ? `${ids}-title-err` : undefined}
        enterKeyHint="done"
      />
      {titleError && (
        <p id={`${ids}-title-err`} role="alert" className="mt-1.5 text-[12px] text-danger">
          {titleError}
        </p>
      )}

      <div className="mt-2">
        <Toggle
          checked={allDay}
          onChange={(v) => {
            setAllDay(v);
            setReminder((r) => reminderAfterAllDayChange(r, v));
          }}
          label="종일"
        />
        {!allDay && (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-2.5">
            <div>
              <span className="mb-1.5 block text-[12px] font-medium leading-4 text-ink-2">
                시작
              </span>
              <TimePicker
                id={`${ids}-start`}
                label="시작 시각"
                value={start}
                onChange={changeStart}
                to={23 * 60 + 30}
                inlineOpen={timeOpen === "start"}
                onInlineToggle={() => setTimeOpen((o) => (o === "start" ? null : "start"))}
              />
            </div>
            <div>
              <span className="mb-1.5 block text-[12px] font-medium leading-4 text-ink-2">종료</span>
              <TimePicker
                id={`${ids}-end`}
                label="종료 시각"
                value={end}
                onChange={changeEnd}
                allow24
                inlineOpen={timeOpen === "end"}
                onInlineToggle={() => setTimeOpen((o) => (o === "end" ? null : "end"))}
                aria-invalid={Boolean(rangeError)}
                aria-describedby={rangeError ? `${ids}-range-err` : undefined}
              />
            </div>
          </div>
        )}
        {!allDay && timeOpen && (
          <div className="mt-2 rounded-sm border border-line p-1.5">
            <TimeList
              key={timeOpen}
              value={timeOpen === "start" ? start : end}
              to={timeOpen === "start" ? 23 * 60 + 30 : undefined}
              allow24={timeOpen === "end"}
              listClassName="max-h-[200px]"
              onPick={(v) => {
                if (timeOpen === "start") changeStart(v);
                else changeEnd(v);
                closeTime();
              }}
              onClose={closeTime}
            />
          </div>
        )}
      </div>
      <div className="mt-2 border-t border-line pt-1">
        <button
          type="button"
          onClick={() => setReminderOpen((o) => !o)}
          aria-expanded={reminderOpen}
          className="flex min-h-11 w-full items-center gap-3 rounded-sm py-1 text-left"
        >
          <span className="shrink-0 text-[14px] font-semibold">알림</span>
          <span className="ml-auto min-w-0 truncate text-[14px] text-ink-2">{REMINDER_LABEL[reminder]}</span>
        </button>
        {reminderOpen && (
          <ReminderInline
            allDay={allDay}
            value={reminder}
            onPick={(v) => {
              setReminder(v);
              setReminderOpen(false);
              // 권한 안내 시트 계기 ② (8-1)
              if (v !== "NONE") void maybeOpenPushPrompt();
            }}
          />
        )}
        <ReminderNote className="-mt-1" />
      </div>
      {rangeError && (
        <p id={`${ids}-range-err`} role="alert" className="mt-1.5 text-[12px] text-danger">
          {rangeError}
        </p>
      )}
      {saveError && (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {saveError}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" size="lg" onClick={more} className="shrink-0 px-4">
          자세히
        </Button>
        <Button type="submit" size="lg" full loading={create.isPending}>
          저장
        </Button>
      </div>
    </form>
  );
}
