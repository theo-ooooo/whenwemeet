"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { IconArrowRight } from "@/components/icons";
import { Chip, ErrorState, Skeleton, Toggle, inputClass } from "@/components/ui";
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
import type { FreeSlots } from "@/lib/types";

type Period = "thisWeek" | "nextWeek" | "custom";

const MIN_OPTIONS = [
  { value: 60, label: "1시간" },
  { value: 120, label: "2시간" },
  { value: 180, label: "3시간" },
  { value: 360, label: "반나절" },
];

// 30분 단위 시각 옵션 (06:00 ~ 24:00)
const TIME_OPTIONS = Array.from({ length: 37 }, (_, i) => {
  const h = Math.floor(i / 2) + 6;
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

export function FreeScreen({ groupId }: { groupId: string }) {
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

  const timeError = dayStart >= dayEnd ? "끝나는 시각은 시작보다 뒤여야 해요" : null;
  const conditionError = range.error ?? timeError;

  // 조건이 바뀌면 300ms 뒤에 다시 계산한다. 조건이 불완전하면 요청하지 않고 직전 결과를 둔다
  const freeQ = useFreeSlots(
    groupId,
    { from: kstToIso(range.from), to: kstToIso(range.to), dayStart, dayEnd, minMinutes, includeAllDay },
    { enabled: !conditionError, debounceMs: 300 },
  );
  const result = freeQ.data;
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
      <h1 className="t-title mt-4 lg:mt-0">빈 시간 찾기</h1>
      <p className="t-sub mt-1.5">모두 비는 시간을 골라 바로 일정으로 만들어요</p>

      <section className="mt-5 space-y-5 rounded-xl bg-paper px-5 py-5">
        <div>
          <h2 className="mb-2 text-[12px] font-semibold text-ink-2">기간</h2>
          <div className="flex gap-2 overflow-x-auto">
            <Chip selected={period === "thisWeek"} onClick={() => setPeriod("thisWeek")}>
              이번 주
            </Chip>
            <Chip selected={period === "nextWeek"} onClick={() => setPeriod("nextWeek")}>
              다음 주
            </Chip>
            <Chip selected={period === "custom"} onClick={() => setPeriod("custom")}>
              직접
            </Chip>
          </div>
          {period === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input
                type="date"
                aria-label="시작일"
                className={inputClass}
                value={customFrom}
                min={today}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <input
                type="date"
                aria-label="종료일"
                className={inputClass}
                value={customTo}
                min={customFrom || today}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-[12px] font-semibold text-ink-2">시간대</h2>
          <div className="flex items-center gap-2">
            <select
              aria-label="시작 시각"
              className={`${inputClass} py-2.5`}
              value={dayStart}
              onChange={(e) => setDayStart(e.target.value)}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-[13px] font-semibold text-ink-2">부터</span>
            <select
              aria-label="끝나는 시각"
              className={`${inputClass} py-2.5`}
              value={dayEnd}
              onChange={(e) => setDayEnd(e.target.value)}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-[12px] font-semibold text-ink-2">최소 길이</h2>
          <div className="flex gap-2 overflow-x-auto">
            {MIN_OPTIONS.map((o) => (
              <Chip key={o.value} selected={minMinutes === o.value} onClick={() => setMinMinutes(o.value)}>
                {o.label}
              </Chip>
            ))}
          </div>
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

      <section className="mt-5" aria-live="polite">
        {conditionError ? (
          <p role="alert" className="px-2 text-[14px] font-semibold text-danger">
            {conditionError}
          </p>
        ) : error ? (
          <ErrorState message={error} onRetry={freeQ.refetch} />
        ) : loading && !result ? (
          <div className="space-y-2 rounded-xl bg-paper p-4" aria-busy="true" aria-label="계산 중">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-12 w-full rounded-[12px]" />
            <Skeleton className="h-12 w-full rounded-[12px]" />
            <Skeleton className="h-12 w-full rounded-[12px]" />
          </div>
        ) : result && result.slots.length === 0 ? (
          <p className="rounded-xl bg-paper px-5 py-8 text-center text-[14px] font-semibold leading-relaxed text-ink-2">
            이 조건에 모두 비는 시간이 없어요.
            <br />
            기간을 늘리거나 최소 길이를 줄여 보세요
          </p>
        ) : result ? (
          <div className={loading ? "opacity-60 transition-opacity" : ""}>
            <p className="px-2 text-[13px] font-semibold text-ink-2">
              <span className="font-bold text-ink">{result.memberCount}명</span> 모두 비는 시간이에요. 각자 다른 팀
              일정도 반영됐어요
            </p>
            <div className="mt-3 space-y-2">
              {grouped.map(([key, slots]) => {
                const p = parseKey(key);
                return (
                  <div key={key} className="rounded-xl bg-paper p-4">
                    <h3 className="flex items-center gap-2 text-[15px] font-extrabold tracking-[-0.02em]">
                      {WEEKDAYS[dowOf(key)]} {p.m}/{p.d}
                      {key === today && <em className="rounded-full bg-ink px-2 py-[3px] text-[11px] font-bold not-italic text-surface">오늘</em>}
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {slots.map((s) => {
                        const mins = Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000);
                        return (
                          <li key={s.startsAt}>
                            <Link
                              href={`/g/${groupId}/events/new?start=${encodeURIComponent(s.startsAt)}&end=${encodeURIComponent(s.endsAt)}`}
                              className="flex items-center justify-between rounded-[14px] bg-surface px-4 py-3 hover:brightness-95"
                            >
                              <span className="text-[16px] font-bold tracking-[-0.02em] tabular-nums">
                                {timeOf(s.startsAt)}~{timeOf(s.endsAt)}
                                <span className="ml-2 text-[12px] font-semibold text-ink-2">{formatMinutes(mins)}</span>
                              </span>
                              <span className="flex items-center gap-1 text-[13px] font-bold">
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
  );
}
