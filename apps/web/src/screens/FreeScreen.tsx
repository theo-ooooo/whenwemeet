"use client";
import Link from "next/link";
import { useGroupContext } from "@/components/AppShell";
import { newEventHref } from "@/lib/routes";
import { useMemo, useState } from "react";
import { IconArrowRight, IconClock } from "@/components/icons";
import { DatePicker, TimePicker } from "@/components/pickers";
import { minutesOf } from "@/components/pickers/time";
import { EmptyState, ErrorState, Segmented, Skeleton, Toggle } from "@/components/ui";
import { messageOf, useFreeSlots } from "@/hooks";
import {
  addDays,
  dateKeyOf,
  daysBetween,
  dowOf,
  formatMinutes,
  kstToIso,
  parseKey,
  startOfWeek,
  timeOf,
  todayKey,
  WEEKDAYS,
} from "@/lib/date";
import { upcomingSlots } from "@/lib/free-time";
import type { FreeSlots } from "@/lib/types";

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

export function FreeScreen() {
  const { groupId } = useGroupContext();
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
  const result = useMemo(
    () => (freeQ.data ? { ...freeQ.data, slots: upcomingSlots(freeQ.data.slots, minMinutes) } : undefined),
    [freeQ.data, minMinutes],
  );
  const loading = freeQ.isLoading;
  const error = freeQ.error ? messageOf(freeQ.error, "빈 시간을 계산하지 못했어요. 다시 시도해 주세요") : null;

  // 날짜별 묶음
  const grouped = useMemo(() => {
    const map = new Map<string, FreeSlots["slots"]>();
    for (const s of result?.slots ?? []) {
      const k = dateKeyOf(s.startsAt);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return Array.from(map.entries());
  }, [result]);

  return (
    <div className="pt-1">
      <div className="flex h-10 items-center">
        <h1 className="t-title">빈 시간 찾기</h1>
      </div>
      <p className="t-sub mt-0.5">모두 비는 시간을 골라 바로 일정으로 만들어요</p>

      {/* 본문 폭 main-lg(≥696, #323): 왼쪽 조건 카드(340, main-xl 400 고정, 스크롤해도 따라옴) + 오른쪽 결과. 그 아래는 위아래 1단 (#244, 디자인규칙.md 2-2) */}
      <div className="main-lg:mt-3 main-lg:grid main-lg:grid-cols-[340px_minmax(0,1fr)] main-xl:grid-cols-[400px_minmax(0,1fr)] main-lg:items-start main-lg:gap-5">
        <section className="mt-3 space-y-3.5 rounded-xl bg-paper px-3.5 py-3.5 main-lg:sticky main-lg:top-7 main-lg:mt-0">
          <div>
            {/* 하나만 고르는 것은 세그먼트 하나로 (기념일 종류, 테마와 같은 모양, #174 L2) */}
            <h2 id="free-period" className="mb-1.5 text-[12px] font-medium leading-4 text-ink-2">기간</h2>
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
            <h2 className="mb-1.5 text-[12px] font-medium leading-4 text-ink-2">시간대</h2>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <TimePicker label="시작 시각" value={dayStart} onChange={setDayStart} to={DAY_END_MAX - 30} />
              </div>
              {/* 가운데 '~' (#174 L12). 스크린리더는 피커 라벨(시작 시각, 끝나는 시각)로 읽는다 */}
              <span aria-hidden="true" className="shrink-0 text-[14px] text-ink-2">~</span>
              <div className="min-w-0 flex-1">
                <TimePicker label="끝나는 시각" value={dayEnd} onChange={setDayEnd} from={30} allow24 />
              </div>
            </div>
          </div>

          <div>
            <h2 id="free-min" className="mb-1.5 text-[12px] font-medium leading-4 text-ink-2">최소 길이</h2>
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
        </section>

        <section className="mt-3 main-lg:mt-0" aria-live="polite">
          {conditionError ? (
            <p role="alert" className="px-1 text-[14px] text-danger">
              {conditionError}
            </p>
          ) : error ? (
            <ErrorState message={error} onRetry={freeQ.refetch} />
          ) : loading && !result ? (
            <div className="space-y-2 rounded-xl bg-paper px-3.5 py-3" aria-busy="true" aria-label="계산 중">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : result && result.slots.length === 0 ? (
            <EmptyState icon={<IconClock size={20} />} title="이 조건에 모두 비는 시간이 없어요">
              기간을 늘리거나 최소 길이를 줄여 보세요
            </EmptyState>
          ) : result ? (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              <p className="px-1 text-[12px] leading-4 text-ink-2">
                {result.memberCount > 1 ? (
                  <>
                    <span className="font-bold text-ink">{result.memberCount}명</span> 모두 비는 시간이에요. 각자 다른 팀
                    일정도 반영됐어요
                  </>
                ) : (
                  // 개인 달력은 "1명 모두" 대신 (#140 L10)
                  <>내 일정 기준으로 비는 시간이에요. 다른 팀 일정도 반영됐어요</>
                )}
              </p>
              {/* 결과 칸이 넓으면(본문 main-2xl) 날짜 카드를 2단으로. 날짜 순서는 위에서 아래, 왼쪽 단 다음 오른쪽 단 (카드 높이가 달라도 빈틈 없이) */}
              <div className="mt-2 space-y-2 main-2xl:columns-2 main-2xl:gap-2 main-2xl:space-y-0">
                {grouped.map(([key, slots]) => {
                  const p = parseKey(key);
                  return (
                    <div key={key} className="rounded-xl bg-paper px-3.5 pb-1.5 pt-1 main-2xl:mb-2 main-2xl:break-inside-avoid">
                      <h3 className="t-sec">
                        {WEEKDAYS[dowOf(key)]} {p.m}/{p.d}
                        {key === today && <em className="text-[12px] font-bold not-italic text-today-ink">오늘</em>}
                      </h3>
                      <ul>
                        {slots.map((s) => {
                          const mins = Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000);
                          return (
                            <li key={s.startsAt}>
                              <Link
                                href={newEventHref({ start: s.startsAt, end: s.endsAt })}
                                className="-mx-1.5 flex min-h-10 items-center justify-between rounded-sm px-1.5 hover:bg-hover"
                              >
                                <span className="text-[14px] tabular-nums">
                                  <b className="font-bold text-acc-ink">
                                    {timeOf(s.startsAt)}~{timeOf(s.endsAt)}
                                  </b>
                                  <span className="ml-2 text-[12px] text-ink-2">{formatMinutes(mins)}</span>
                                </span>
                                <span className="flex items-center gap-1 text-[12px] font-medium text-ink-2">
                                  일정 만들기
                                  <IconArrowRight size={14} />
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
