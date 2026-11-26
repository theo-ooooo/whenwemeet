"use client";
// (#305) 내 정보 > "내 생일" 한 줄과 고르기 시트 (D-230 ~ D-232).
// 줄 모양은 같은 화면의 "처음 여는 달력", "알림" 줄. 시트는 생일 줄(월, 일 고르기, 연도 없음) + 팀원에게 알리는 시점 줄(기념일 알림과 같은 규칙, #378).
// 저장하면 내가 속한 모든 팀 달력에 "닉네임 생일" 로 매년 보인다. 팀마다 끄기는 팀 설정
import { useEffect, useRef, useState } from "react";
import { CalendarKindRow } from "./CalendarKindRow";
import { IconCalendar, IconChevronRight, IconHeart } from "./icons";
import { MonthDayPicker, type MonthDay } from "./pickers/MonthDayPicker";
import { ReminderChoicesRow } from "./ReminderChoicesRow";
import { useToast } from "./Toast";
import { Button, InlineError, RowGroup, Sheet } from "./ui";
import { messageOf, useUpdateBirthday } from "@/hooks";
import { DEFAULT_REMINDERS, normalizeReminders, sameReminders } from "@/lib/anniversary-reminder";
import { lunarYearHint } from "@/lib/anniversary";
import { BIRTHDAY_ANCHOR_YEAR, clampDay, formatBirthday, parseBirthday, toBirthday } from "@/lib/birthday";
import { todayKey } from "@/lib/date";
import type { CalendarKind } from "@/lib/lunar";
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
  // 고른 월, 일. 아직 없으면 null (줄에 "고르기", 저장은 고른 뒤에)
  const [picked, setPicked] = useState<MonthDay | null>(null);
  const [reminders, setReminders] = useState<AnniversaryReminder[]>([...DEFAULT_REMINDERS]);
  // (#562) 양력/음력, 윤달. 음력이면 picked 가 음력 월일 (달마다 30일까지)
  const [calendar, setCalendar] = useState<CalendarKind>("SOLAR");
  const [leap, setLeap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { mutate, isPending } = useUpdateBirthday();

  function openSheet() {
    if (!value) return;
    const cal = value.calendar ?? "SOLAR";
    setCalendar(cal);
    setLeap(value.isLeapMonth ?? false);
    setPicked(parseBirthday(value.date, cal));
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
    const input: { date: string | null; reminders?: AnniversaryReminder[]; calendar?: CalendarKind; isLeapMonth?: boolean } = { date: next };
    // (#562) 음력일 때만 달력 종류와 윤달을 싣는다 (생략은 양력)
    if (next !== null && calendar === "LUNAR") Object.assign(input, { calendar, isLeapMonth: leap });
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

  const label = ready ? (formatBirthday(value.date, value.calendar, value.isLeapMonth) ?? "넣지 않음") : "";

  // (#562) 양력 ↔ 음력: 생일은 연도가 없어 월일은 그대로 두고 그 달에 없는 날만 줄인다 (양력 4월 31일은 없음)
  function changeCalendar(next: CalendarKind) {
    if (next === "SOLAR" && picked) setPicked({ m: picked.m, d: clampDay(picked.m, picked.d) });
    if (next === "SOLAR") setLeap(false);
    setCalendar(next);
  }
  const lunarHint =
    calendar === "LUNAR" && picked
      ? lunarYearHint({ date: `${BIRTHDAY_ANCHOR_YEAR}-${toBirthday(picked.m, picked.d)}`, calendar, isLeapMonth: leap, kind: "YEARLY" }, todayKey())
      : null;

  return (
    <>
      <button
        id="birthday"
        type="button"
        onClick={openSheet}
        disabled={!ready}
        aria-haspopup="dialog"
        // (#378) 내 정보의 설정 줄 묶음(RowGroup) 안 한 줄: "아이콘 이름 ··· 값 ›" (ui.tsx RowButton 과 같은 모양)
        className="flex min-h-11 w-full scroll-mt-4 items-center gap-3 py-1 text-left disabled:cursor-default"
      >
        <IconHeart size={18} className="mx-px shrink-0 text-ink-2" />
        <span className="shrink-0 text-[14px] font-semibold">내 생일</span>
        <span className="min-w-0 flex-1 truncate text-right text-[14px] text-ink-2">{label}</span>
        <IconChevronRight size={16} className="-mr-1 shrink-0 text-ink-2" />
      </button>

      {ready && (
        <Sheet open={open} onClose={() => setOpen(false)} title="내 생일" tone="bg">
          {/* (#378) 기기 기본 선택 상자 둘 대신 날짜 줄 하나(월, 일 고르기 시트) + 알림 줄. 안내 한 줄, 맨 아래 저장 */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (picked) void save(toBirthday(picked.m, picked.d));
            }}
            className="space-y-2 pb-1"
          >
            <RowGroup hint="내가 속한 팀 달력에 매년 보여요. 연도는 받지 않아요">
              <MonthDayPicker label="생일" icon={<IconCalendar size={18} />} value={picked} onChange={setPicked} lunar={calendar === "LUNAR"} leap={leap} />
              {/* (#562) 양력/음력, 음력이면 윤달 */}
              <CalendarKindRow calendar={calendar} onCalendar={changeCalendar} leap={leap} onLeap={setLeap} />
              {/* 팀원에게 알리는 시점: 기념일 알림과 같은 규칙 (#269). 나에게는 오지 않는다 */}
              <ReminderChoicesRow label="팀원에게 알림" value={reminders} onChange={setReminders} />
            </RowGroup>
            {calendar === "SOLAR" && picked?.m === 2 && picked.d === 29 && <p className="t-sub px-1">윤년이 아닌 해에는 2월 28일에 보여요</p>}
            {lunarHint && <p className="t-sub px-1">{lunarHint}</p>}
            {error && <InlineError className="px-1">{error}</InlineError>}
            <div className="space-y-2 pt-1">
              <Button type="submit" size="xl" full disabled={!picked} loading={isPending}>
                저장
              </Button>
              {value.date !== null && (
                <Button type="button" variant="ghost" size="lg" full disabled={isPending} onClick={() => void save(null)} className="text-danger!">
                  생일 지우기
                </Button>
              )}
            </div>
            <p className="t-sub px-1 text-center">팀마다 보이지 않게 하려면 팀 설정에서 끄면 돼요</p>
          </form>
        </Sheet>
      )}
    </>
  );
}
