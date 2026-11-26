"use client";
// 빈 시간 찾기 (#378 B 개편). 조건은 칩 한 줄("이번 주", "오전 9:00 ~ 오후 11:00", "2시간 이상", "종일 일정 제외", "조건")로 접고
// 누르면 예전 조건 칸을 시트로 연다. 결과 위 "바로 일정 만들기 | 후보 골라 투표"(팀이고 둘 이상일 때), 요약 한 줄
// ("둘 모두 비는 시간 5곳. 가장 긴 곳은 토 11/14 오전 9:00 ~ 오후 4:00"), 날짜마다 하루 막대(DayBar, 서버 결과 free) + 시간 칩(가장 긴 곳 강조).
// 칩: 만들기 모드는 일정 만들기 화면(그 시각으로), 투표 모드는 후보 체크 → 아래 버튼 → 투표 만들기 시트(PollCreateSheet).
// 넓은 화면(본문 main-lg)은 결과를 두 열로
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useGroupContext } from "@/components/AppShell";
import { newEventHref, pollHref } from "@/lib/routes";
import { useMemo, useState } from "react";
import { PollCreateSheet } from "@/components/PollCreateSheet";
import { useToast } from "@/components/Toast";
import { DayBar } from "@/components/DayBar";
import { IconCheck, IconChevronDown, IconClock } from "@/components/icons";
import { DatePicker, TimePicker } from "@/components/pickers";
import { minutesOf } from "@/components/pickers/time";
import { Button, EmptyState, ErrorState, Segmented, Sheet, Skeleton, Toggle } from "@/components/ui";
import { messageOf, useFreeSlots } from "@/hooks";
import { addDays, clockRangeText, clockText, dateKeyOf, daysBetween, formatMinutes, kstToIso, startOfWeek, todayKey } from "@/lib/date";
import { upcomingSlots } from "@/lib/free-time";
import { dayRangeText, groupFreeDays, longestSlot, minLengthText, periodText, shortDay, whoText } from "@/lib/free-view";
import { MAX_POLL_OPTIONS, MIN_POLL_OPTIONS, slotKey, type Slot } from "@/lib/poll";

type Period = "thisWeek" | "nextWeek" | "custom";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "thisWeek", label: "이번 주" },
  { value: "nextWeek", label: "다음 주" },
  { value: "custom", label: "직접" },
];

const MIN_OPTIONS = [
  { value: 60, label: "1시간" },
  { value: 120, label: "2시간" },
  { value: 180, label: "3시간" },
  { value: 360, label: "반나절" },
];

// 시간대 시각 피커 범위(분). 시작은 00:00~23:30, 끝은 00:30~24:00 (24:00 = 자정까지, #58)
const DAY_END_MAX = 24 * 60;

type Mode = "make" | "poll";
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "make", label: "바로 일정 만들기" },
  { value: "poll", label: "후보 골라 투표" },
];

/** 칩 시각 "09:00" 그대로, 요약은 앞 0 을 뗀다 "9:00" */

export function FreeScreen() {
  const { groupId, group } = useGroupContext();
  const router = useRouter();
  const toast = useToast();
  // (#189) 투표로 정하기: 결과 줄을 2~5개 골라 투표 만들기 시트로 (설계 약속-투표.md 5-1). 개인 팀은 숨긴다
  const [mode, setMode] = useState<Mode>("make");
  const [picked, setPicked] = useState<Slot[]>([]);
  const [sheet, setSheet] = useState(false);
  // (#378 B) 조건 시트
  const [condOpen, setCondOpen] = useState(false);
  const today = todayKey();
  const [period, setPeriod] = useState<Period>("thisWeek");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(addDays(today, 6));
  const [dayStart, setDayStart] = useState("09:00");
  const [dayEnd, setDayEnd] = useState("23:00");
  const [minMinutes, setMinMinutes] = useState(120);
  const [includeAllDay, setIncludeAllDay] = useState(false);

  const range = useMemo(() => {
    if (period === "thisWeek") {
      const s = startOfWeek(today);
      return { from: s, to: addDays(s, 7), error: null as string | null };
    }
    if (period === "nextWeek") {
      const s = addDays(startOfWeek(today), 7);
      return { from: s, to: addDays(s, 7), error: null as string | null };
    }
    if (!customFrom || !customTo) return { from: today, to: addDays(today, 1), error: "시작일과 종료일을 골라 주세요" };
    const len = daysBetween(customFrom, customTo) + 1;
    if (len < 1) return { from: customFrom, to: addDays(customFrom, 1), error: "종료일은 시작일과 같거나 뒤여야 해요" };
    if (len > 31) return { from: customFrom, to: addDays(customFrom, 31), error: "기간은 31일까지 잡을 수 있어요" };
    return { from: customFrom, to: addDays(customTo, 1), error: null as string | null };
  }, [period, customFrom, customTo, today]);

  const timeError = (minutesOf(dayStart) ?? 0) >= (minutesOf(dayEnd) ?? 0) ? "끝나는 시각은 시작보다 뒤여야 해요" : null;
  const conditionError = range.error ?? timeError;

  // 조건이 바뀌면 300ms 뒤에 다시 계산한다. 조건이 불완전하면 요청하지 않고 직전 결과를 둔다
  const freeQ = useFreeSlots(
    groupId,
    { from: kstToIso(range.from), to: kstToIso(range.to), dayStart, dayEnd, minMinutes, includeAllDay },
    { enabled: !conditionError, debounceMs: 300 },
  );
  // 달력 개요와 같은 규칙(지금을 30분 경계로 올림)으로 자른다 (#136)
  const result = useMemo(() => (freeQ.data ? { ...freeQ.data, slots: upcomingSlots(freeQ.data.slots, minMinutes) } : undefined), [freeQ.data, minMinutes]);
  const loading = freeQ.isLoading;
  const error = freeQ.error ? messageOf(freeQ.error, "빈 시간을 계산하지 못했어요. 다시 시도해 주세요") : null;

  const canPoll = group?.type === "TEAM" && (result?.memberCount ?? 0) > 1 && (result?.slots.length ?? 0) > 0;
  const pollMode = canPoll && mode === "poll";
  const pickedKeys = new Set(picked.map(slotKey));
  function togglePick(slot: Slot) {
    const key = slotKey(slot);
    if (pickedKeys.has(key)) return setPicked((list) => list.filter((s) => slotKey(s) !== key));
    if (picked.length >= MAX_POLL_OPTIONS) return toast.show(`후보는 ${MAX_POLL_OPTIONS}개까지 고를 수 있어요`);
    setPicked((list) => [...list, slot]);
  }

  // 날짜별 묶음 (하루 막대 + 칩), 가장 긴 곳
  const days = useMemo(() => groupFreeDays(result?.slots ?? []), [result]);
  const best = useMemo(() => longestSlot(result?.slots ?? []), [result]);
  const bestKey = best ? slotKey(best) : null;
  // 하루 막대 창: 검색 시간대 (시 단위로 넓힌다)
  const fromHour = Math.floor((minutesOf(dayStart) ?? 0) / 60);
  const toHour = Math.max(fromHour + 1, Math.ceil((minutesOf(dayEnd) ?? DAY_END_MAX) / 60));
  const [now] = useState(Date.now);

  // 조건 칩: 누르는 칸 44(위아래 투명), 보이는 알약 36
  const chipCls = "group flex h-11 shrink-0 items-center";
  const pill = "flex h-9 items-center gap-1 whitespace-nowrap rounded-full bg-paper px-3 text-[13px] font-semibold group-hover:bg-hover";

  return (
    <div className="pt-1">
      <div className="flex h-10 items-center">
        <h1 className="t-title">빈 시간 찾기</h1>
      </div>

      {/* 조건 칩 한 줄 (기간, 시간대, 최소 길이, 종일 일정). 어느 칩이든 누르면 조건 시트.
          폰에서 한 줄에 다 안 들어가면 값 칩만 옆으로 밀고 "조건" 은 오른쪽 끝에 둔다.
          (QA 2026-11-14) 종일 일정 칩도 폰에 보인다: 조건이 결과에 적용되는데 폰에서만 빠져 있었다 */}
      <div role="group" aria-label="찾는 조건" className="mt-1 flex items-center gap-1.5">
        <div className="-ml-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pl-4 fold:flex-initial [scrollbar-width:none] fold:ml-0 fold:flex-wrap fold:overflow-visible fold:pl-0 [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`기간 ${periodText(period, range.from, addDays(range.to, -1))}, 조건 바꾸기`}
            onClick={() => setCondOpen(true)}
            className={chipCls}
          >
            <span className={pill}>{periodText(period, range.from, addDays(range.to, -1))}</span>
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`시간대 ${dayRangeText(dayStart, dayEnd)}, 조건 바꾸기`}
            onClick={() => setCondOpen(true)}
            className={chipCls}
          >
            <span className={pill}>{dayRangeText(dayStart, dayEnd)}</span>
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`최소 길이 ${minLengthText(minMinutes)}, 조건 바꾸기`}
            onClick={() => setCondOpen(true)}
            className={chipCls}
          >
            <span className={pill}>{minLengthText(minMinutes)}</span>
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`${includeAllDay ? "종일 일정 포함" : "종일 일정 제외"}, 조건 바꾸기`}
            onClick={() => setCondOpen(true)}
            className={chipCls}
          >
            <span className={pill}>{includeAllDay ? "종일 일정 포함" : "종일 일정 제외"}</span>
          </button>
        </div>
        <button type="button" aria-haspopup="dialog" onClick={() => setCondOpen(true)} className={`${chipCls} text-ink-2`}>
          <span className={pill}>
            조건
            <IconChevronDown size={14} />
          </span>
        </button>
      </div>

      {/* 결과 위 모드: 팀이고 둘 이상이며 결과가 있을 때만 (#189 투표로 정하기) */}
      {canPoll && (
        <div className="mt-3 fold:max-w-[360px]">
          <span id="free-mode" className="sr-only">
            고른 시간으로 할 일
          </span>
          <Segmented
            labelledBy="free-mode"
            value={mode}
            options={MODE_OPTIONS}
            onChange={(v) => {
              setMode(v);
              setPicked([]);
            }}
          />
        </div>
      )}

      <section className="mt-3" aria-live="polite">
        {conditionError ? (
          <p role="alert" className="px-1 text-[14px] text-danger">
            {conditionError}
          </p>
        ) : error ? (
          <ErrorState message={error} onRetry={freeQ.refetch} />
        ) : loading && !result ? (
          <div className="space-y-2" aria-busy="true" aria-label="계산 중">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-[108px] w-full rounded-xl" />
            <Skeleton className="h-[108px] w-full rounded-xl" />
          </div>
        ) : result && result.slots.length === 0 ? (
          <EmptyState icon={<IconClock size={20} />} title="이 조건에 모두 비는 시간이 없어요">
            기간을 늘리거나 최소 길이를 줄여 보세요
          </EmptyState>
        ) : result ? (
          <div className={loading ? "opacity-60 transition-opacity" : ""}>
            {/* 요약 한 줄: "둘 모두 비는 시간 5곳. 가장 긴 곳은 토 11/14 오전 9:00 ~ 오후 4:00" */}
            <p className="px-1 text-[13px] leading-5 text-ink-2">
              <b className="font-bold text-ink">{whoText(result.memberCount)}</b> 비는 시간 <b className="font-bold text-ink">{result.slots.length}곳</b>
              {best && (
                <>
                  . 가장 긴 곳은 {/* 시각이 "오후 / 4:00" 처럼 줄 끝에서 갈라지지 않게 한 덩이로 */}
                  <span className="whitespace-nowrap">
                    {shortDay(dateKeyOf(best.startsAt))} {clockRangeText(best.startsAt, best.endsAt)}
                  </span>
                </>
              )}
            </p>
            {pollMode && <p className="mt-1 px-1 text-[12px] leading-4 text-ink">후보로 물어볼 시간을 2~5개 골라 주세요</p>}

            <ul className="mt-2 space-y-2 main-lg:grid main-lg:grid-cols-2 main-lg:items-start main-lg:gap-2 main-lg:space-y-0">
              {days.map((d) => (
                <li key={d.date} className="rounded-xl bg-paper px-3.5 pb-3 pt-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-[14px] font-bold leading-5">
                      {shortDay(d.date)}
                      {d.date === today && <em className="ml-1.5 text-[12px] font-bold not-italic text-today-ink">오늘</em>}
                    </h2>
                    <small className="shrink-0 text-[12px] font-bold text-acc-ink">{formatMinutes(d.minutes)}</small>
                  </div>
                  <DayBar
                    bare
                    hideHead
                    className="mt-2"
                    date={d.date}
                    fromHour={fromHour}
                    toHour={toHour}
                    members={[]}
                    free={d.free}
                    memberCount={result.memberCount}
                    title={shortDay(d.date)}
                    now={d.date === today ? now : undefined}
                  />
                  <ul aria-label={`${shortDay(d.date)} 비는 시간`} className="mt-2.5 flex flex-wrap gap-x-1.5 gap-y-2">
                    {d.slots.map((s) => {
                      const mins = Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000);
                      const text = clockRangeText(s.startsAt, s.endsAt);
                      const say = `${shortDay(d.date)} ${clockText(s.startsAt)}부터 ${clockText(s.endsAt)}까지, ${formatMinutes(mins)}`;
                      const isBest = slotKey(s) === bestKey;
                      const base = "hit flex h-9 items-center gap-1 rounded-[10px] border-[1.5px] px-2.5 text-[13px] font-bold tabular-nums";
                      if (pollMode) {
                        const on = pickedKeys.has(slotKey(s));
                        return (
                          <li key={s.startsAt}>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              aria-label={`${say}, 후보로 고르기`}
                              onClick={() => togglePick(s)}
                              className={`${base} ${on ? "border-btn bg-btn text-on-btn" : "border-line text-ink hover:bg-hover"}`}
                            >
                              {on && <IconCheck size={14} strokeWidth={2.6} />}
                              {text}
                            </button>
                          </li>
                        );
                      }
                      return (
                        <li key={s.startsAt}>
                          <Link
                            href={newEventHref({ start: s.startsAt, end: s.endsAt })}
                            aria-label={`${say}${isBest ? ", 가장 긴 곳" : ""}, 일정 만들기`}
                            className={`${base} ${isBest ? "border-pri bg-pri text-on-pri hover:brightness-95" : "border-pri text-acc-ink hover:bg-hover"}`}
                          >
                            {text}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* (#189) 아래 고정 줄. 폰은 독 위(토스트와 같은 높이 규칙), 넓은 화면은 결과 아래에 붙는다 */}
        {pollMode && (
          <div className="fixed inset-x-4 bottom-[calc(168px+var(--sab))] z-30 dock:bottom-[calc(92px+var(--sab))] fold:sticky fold:inset-x-auto fold:bottom-4 fold:mt-3 fold:max-w-[480px]">
            <Button size="xl" full disabled={picked.length < MIN_POLL_OPTIONS} onClick={() => setSheet(true)} className="shadow-[var(--dock-shadow)]">
              {picked.length < MIN_POLL_OPTIONS ? `후보를 ${MIN_POLL_OPTIONS - picked.length}개 더 골라 주세요` : `후보 ${picked.length}개로 투표 만들기`}
            </Button>
          </div>
        )}
        {pollMode && <div aria-hidden="true" className="h-16 fold:hidden" />}
      </section>

      {/* 조건 시트: 예전 조건 칸 그대로 (기간, 시간대, 최소 길이, 종일 일정). 바꾸는 즉시 다시 계산한다 */}
      <Sheet open={condOpen} onClose={() => setCondOpen(false)} title="찾는 조건">
        <div className="space-y-3.5 pb-1">
          <div>
            {/* 하나만 고르는 것은 세그먼트 하나로 (기념일 종류, 테마와 같은 모양, #174 L2) */}
            <h3 id="free-period" className="mb-1.5 text-[12px] font-medium leading-4 text-ink-2">
              기간
            </h3>
            <Segmented labelledBy="free-period" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
            {period === "custom" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <DatePicker
                  label="시작일"
                  value={customFrom}
                  min={today}
                  onChange={(v) => {
                    // 시작일을 종료일 뒤로 옮기면 기간 길이를 유지하게 종료일도 민다 (#67)
                    const len = Math.max(0, daysBetween(customFrom, customTo));
                    setCustomFrom(v);
                    if (v > customTo) setCustomTo(addDays(v, len));
                  }}
                />
                <DatePicker label="종료일" value={customTo} min={customFrom || today} onChange={setCustomTo} />
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-1.5 text-[12px] font-medium leading-4 text-ink-2">시간대</h3>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <TimePicker label="시작 시각" value={dayStart} onChange={setDayStart} to={DAY_END_MAX - 30} />
              </div>
              {/* 가운데 '~' (#174 L12). 스크린리더는 피커 라벨(시작 시각, 끝나는 시각)로 읽는다 */}
              <span aria-hidden="true" className="shrink-0 text-[14px] text-ink-2">
                ~
              </span>
              <div className="min-w-0 flex-1">
                <TimePicker label="끝나는 시각" value={dayEnd} onChange={setDayEnd} from={30} allow24 />
              </div>
            </div>
          </div>

          <div>
            <h3 id="free-min" className="mb-1.5 text-[12px] font-medium leading-4 text-ink-2">
              최소 길이
            </h3>
            <Segmented
              labelledBy="free-min"
              value={String(minMinutes)}
              options={MIN_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
              onChange={(v) => setMinMinutes(Number(v))}
            />
          </div>

          <div className="border-t border-line pt-3">
            <Toggle
              checked={includeAllDay}
              onChange={setIncludeAllDay}
              label="종일 일정도 바쁜 시간으로"
              description="여행, 휴가처럼 하루를 비우는 일정이 있을 때 켜 주세요"
            />
          </div>
          {conditionError && (
            <p role="alert" className="text-[13px] text-danger">
              {conditionError}
            </p>
          )}
          <Button size="xl" full onClick={() => setCondOpen(false)}>
            결과 보기
          </Button>
        </div>
      </Sheet>

      <PollCreateSheet
        open={sheet}
        onClose={() => setSheet(false)}
        groupId={groupId}
        members={group?.members ?? []}
        meId={group?.me.userId ?? null}
        slots={picked}
        minMinutes={minMinutes}
        onCreated={(poll) => {
          setSheet(false);
          toast.show("투표를 열었어요");
          router.push(pollHref(poll));
        }}
      />
    </div>
  );
}
