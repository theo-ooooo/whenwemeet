"use client";
// (#305) 내 정보 > "내 생일" 한 줄과 고르기 시트 (D-230 ~ D-232).
// 줄 모양은 같은 화면의 "처음 여는 달력", "알림" 줄. 시트는 생일 줄(월, 일 고르기, 연도 없음) + 팀원에게 알리는 시점 줄(기념일 알림과 같은 규칙, #378).
// 저장하면 내가 속한 모든 팀 달력에 "닉네임 생일" 로 매년 보인다. 팀마다 끄기는 팀 설정
import { useEffect, useRef, useState } from "react";
import { IconCalendar, IconChevronRight, IconHeart } from "./icons";
import { MonthDayPicker, type MonthDay } from "./pickers/MonthDayPicker";
import { ReminderChoicesRow } from "./ReminderChoicesRow";
import { useToast } from "./Toast";
import { Button, InlineError, RowGroup, Sheet } from "./ui";
import { messageOf, useUpdateBirthday } from "@/hooks";
import { DEFAULT_REMINDERS, normalizeReminders, sameReminders } from "@/lib/anniversary-reminder";
import { formatBirthday, parseBirthday, toBirthday } from "@/lib/birthday";
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
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { mutate, isPending } = useUpdateBirthday();

  function openSheet() {
    if (!value) return;
    setPicked(parseBirthday(value.date));
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
              <MonthDayPicker label="생일" icon={<IconCalendar size={18} />} value={picked} onChange={setPicked} />
              {/* 팀원에게 알리는 시점: 기념일 알림과 같은 규칙 (#269). 나에게는 오지 않는다 */}
              <ReminderChoicesRow label="팀원에게 알림" value={reminders} onChange={setReminders} />
            </RowGroup>
            {picked?.m === 2 && picked.d === 29 && <p className="t-sub px-1">윤년이 아닌 해에는 2월 28일에 보여요</p>}
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
