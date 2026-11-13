"use client";
// (#305) 내 정보 > "내 생일" 한 줄과 고르기 시트 (D-230 ~ D-232).
// 줄 모양은 같은 화면의 "처음 여는 달력", "알림" 줄. 시트는 월, 일 고르기(연도 없음) + 팀원에게 알리는 시점(기념일 알림 칩 그대로).
// 저장하면 내가 속한 모든 팀 달력에 "닉네임 생일" 로 매년 보인다. 팀마다 끄기는 팀 설정
import { useEffect, useId, useRef, useState } from "react";
import { IconChevronRight, IconHeart } from "./icons";
import { ReminderNote } from "./ReminderPicker";
import { useToast } from "./Toast";
import { Button, InlineError, Sheet, ToggleChips, captionClass, inputClass } from "./ui";
import { messageOf, useUpdateBirthday } from "@/hooks";
import { DEFAULT_REMINDERS, REMINDER_CHOICES, isChoiceOn, normalizeReminders, sameReminders, toggleReminder } from "@/lib/anniversary-reminder";
import { MONTH_DAYS, clampDay, formatBirthday, parseBirthday, toBirthday } from "@/lib/birthday";
import type { AnniversaryReminder, BirthdaySettings } from "@/lib/types";

/** 화면이 /me#birthday 로 열렸는가 (기념일 화면의 "내 생일 넣기") */
const openedByHash = () => typeof window !== "undefined" && window.location.hash === "#birthday";

export function BirthdayRow({
  value,
  onChange,
}: {
  /** GET /me 의 birthday. 아직 못 받았으면 undefined */
  value: BirthdaySettings | undefined;
  onChange: (next: BirthdaySettings) => void;
}) {
  const ready = value !== undefined;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [reminders, setReminders] = useState<AnniversaryReminder[]>([...DEFAULT_REMINDERS]);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { mutate, isPending } = useUpdateBirthday();
  const monthId = useId();
  const dayId = useId();
  const reminderLabelId = useId();

  function openSheet() {
    if (!value) return;
    const p = parseBirthday(value.date);
    setMonth(p?.m ?? 1);
    setDay(p?.d ?? 1);
    setReminders(normalizeReminders(value.reminders));
    setError(null);
    setOpen(true);
  }

  // 기념일 화면의 "내 생일 넣기" (/me#birthday) 로 왔으면 받자마자 시트를 연다. 한 번만.
  // 효과 본문에서 바로 setState 하지 않도록 마이크로태스크로 미룬다 (hooks/_useQuery 와 같은 방식)
  const hashHandled = useRef(false);
  const openRef = useRef(openSheet);
  useEffect(() => {
    openRef.current = openSheet;
  });
  useEffect(() => {
    if (!ready || hashHandled.current) return;
    hashHandled.current = true;
    if (openedByHash()) queueMicrotask(() => openRef.current());
  }, [ready]);

  async function save(next: string | null) {
    if (!value || isPending) return;
    setError(null);
    const input: { date: string | null; reminders?: AnniversaryReminder[] } = { date: next };
    if (next !== null && !sameReminders(reminders, value.reminders)) input.reminders = reminders;
    const r = await mutate(input);
    if (!r.ok) {
      setError(messageOf(r.error, "생일을 저장하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    onChange(r.data);
    setOpen(false);
    toast.show(next === null ? "생일을 지웠어요" : "생일을 저장했어요");
  }

  const label = ready ? (formatBirthday(value.date) ?? "넣지 않음") : "";

  return (
    <>
      <button
        id="birthday"
        type="button"
        onClick={openSheet}
        disabled={!ready}
        aria-haspopup="dialog"
        className="mt-2 flex min-h-12 w-full scroll-mt-4 items-center gap-2.5 rounded-xl bg-paper px-3.5 py-2 text-left hover:brightness-95 disabled:cursor-default"
      >
        <IconHeart size={18} className="shrink-0 text-ink-2" />
        <span className="shrink-0 text-[15px] font-semibold">내 생일</span>
        <span className="min-w-0 flex-1 truncate text-right text-[13px] text-ink-2">{label}</span>
        <IconChevronRight size={14} className="shrink-0 text-ink-2" />
      </button>

      {ready && (
        <Sheet open={open} onClose={() => setOpen(false)} title="내 생일">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(toBirthday(month, day));
            }}
            className="space-y-3"
          >
            <p className="t-sub">넣으면 내가 속한 팀 달력에 매년 보여요. 연도는 받지 않아요</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor={monthId} className={captionClass}>
                  월
                </label>
                <select
                  id={monthId}
                  className={inputClass}
                  value={month}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    setMonth(m);
                    setDay((d) => clampDay(m, d));
                  }}
                >
                  {MONTH_DAYS.map((_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}월
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor={dayId} className={captionClass}>
                  일
                </label>
                <select id={dayId} className={inputClass} value={day} onChange={(e) => setDay(Number(e.target.value))}>
                  {Array.from({ length: MONTH_DAYS[month - 1] }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}일
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {month === 2 && day === 29 && <p className="t-sub">윤년이 아닌 해에는 2월 28일에 보여요</p>}
            {/* 팀원에게 알리는 시점: 기념일 알림과 같은 칩 (#269). 나에게는 오지 않는다 */}
            <div>
              <span id={reminderLabelId} className={captionClass}>
                팀원에게 알림 <span className="font-normal">(오전 9시)</span>
              </span>
              <ToggleChips
                labelledBy={reminderLabelId}
                options={REMINDER_CHOICES}
                isOn={(v) => isChoiceOn(reminders, v)}
                onToggle={(v) => setReminders((prev) => toggleReminder(prev, v))}
              />
              <ReminderNote className="mt-1.5" />
            </div>
            <p className="t-sub">팀마다 보이지 않게 하려면 팀 설정에서 끄면 돼요</p>
            {error && <InlineError>{error}</InlineError>}
            <Button type="submit" size="lg" full loading={isPending}>
              저장
            </Button>
            {value.date !== null && (
              <Button type="button" variant="danger" size="lg" full disabled={isPending} onClick={() => void save(null)}>
                생일 지우기
              </Button>
            )}
          </form>
        </Sheet>
      )}
    </>
  );
}
