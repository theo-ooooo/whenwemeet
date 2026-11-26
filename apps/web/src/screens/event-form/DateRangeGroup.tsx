"use client";
// (#497) 일정 폼 2. 종일, 시작, 종료. EventFormScreen 에서 옮김
// (#566, D-298) 음력 입력 (#570 부터 날짜 카드 아래 따로 "음력으로 입력" 스위치 카드). 음력이면 시작 날짜를 음력 월일(해 넘기기 포함)로 고르고, 바로 아래 "윤달" 체크와 바뀐 양력
// "양력 11월 24일 (화)" 을 보인다. 그 해에 없는 윤달, 29일 달의 30일은 빨간 한 줄로 저장을 막는다. 종료는 양력 그대로(길이 유지)
import { useId } from "react";
import { DatePicker, TimePicker } from "@/components/pickers";
import { MonthDayPicker } from "@/components/pickers/MonthDayPicker";
import { InlineError, RowGroup, ToggleRow } from "@/components/ui";
import { formatDateKo } from "@/lib/date";
import type { DraftAction, EventDraft } from "@/lib/event-draft";

type Props = {
  draft: EventDraft;
  dispatch: React.Dispatch<DraftAction>;
  touched: boolean;
  rangeError: string | null;
  /** (#566) 음력으로 고른 날짜가 없는 날일 때 */
  lunarError?: string | null;
};

export function DateRangeGroup({ draft, dispatch, touched, rangeError, lunarError = null }: Props) {
  const { allDay, startDate, startTime, endDate, endTime, lunar } = draft;
  const leapId = useId();
  const startDateControl = lunar ? (
    <MonthDayPicker
      look="chip"
      label="시작 날짜 (음력)"
      lunar
      withYear
      leap={lunar.leap}
      value={{ y: lunar.year, m: lunar.month, d: lunar.day }}
      onChange={(v) => dispatch({ type: "lunar", value: { year: v.y ?? lunar.year, month: v.m, day: v.d, leap: lunar.leap } })}
    />
  ) : (
    <DatePicker look="chip" label="시작 날짜" value={startDate} onChange={(v) => dispatch({ type: "start", date: v, time: startTime })} />
  );
  return (
    <>
      <RowGroup>
        <ToggleRow label="종일" checked={allDay} onChange={(v) => dispatch({ type: "allDay", value: v })} />
        {(
          [
            { key: "start", label: "시작", date: startDate, time: startTime },
            { key: "end", label: "종료", date: endDate, time: endTime },
          ] as const
        ).map((row) => (
          <div key={row.key}>
            <div className="flex min-h-12 items-center gap-2 py-1.5">
              <span aria-hidden="true" className="w-9 shrink-0 text-[14px] text-ink-2">
                {row.label}
              </span>
              <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5">
                {row.key === "start" ? (
                  startDateControl
                ) : (
                  <DatePicker
                    look="chip"
                    label={`${row.label} 날짜`}
                    value={row.date}
                    min={startDate}
                    onChange={(v) => dispatch({ type: "end", date: v, time: endTime, by: "date" })}
                  />
                )}
                {!allDay && (
                  <TimePicker
                    look="chip"
                    label={`${row.label} 시각`}
                    value={row.time}
                    onChange={(v) =>
                      dispatch(row.key === "start" ? { type: "start", date: startDate, time: v } : { type: "end", date: endDate, time: v, by: "time" })
                    }
                  />
                )}
              </div>
            </div>
            {/* (#566) 음력: 윤달 체크 + 바뀐 양력 날짜(또는 이유 한 줄) */}
            {row.key === "start" && lunar && (
              <div className="pb-2">
                <div className="flex min-h-8 items-center gap-2">
                  <input
                    id={leapId}
                    type="checkbox"
                    checked={lunar.leap}
                    onChange={(e) => dispatch({ type: "lunar", value: { ...lunar, leap: e.target.checked } })}
                    className="size-[18px] shrink-0 accent-[var(--pri)]"
                  />
                  <label htmlFor={leapId} className="text-[14px] font-semibold">
                    윤달
                  </label>
                  {!lunarError && (
                    <span aria-live="polite" className="ml-auto min-w-0 truncate text-[13px] font-semibold text-ink tabular-nums">
                      양력 {formatDateKo(startDate)}
                    </span>
                  )}
                </div>
                {lunarError && <InlineError className="mt-1">{lunarError}</InlineError>}
              </div>
            )}
          </div>
        ))}
        {rangeError && <div className="py-2">{touched ? <InlineError>{rangeError}</InlineError> : <p className="t-sub">{rangeError}</p>}</div>}
      </RowGroup>
      {/* (#570) 음력 입력은 날짜 카드 밖 따로 한 장. 켜면 위 시작 날짜가 음력 칩이 된다 */}
      <RowGroup>
        <ToggleRow
          label="음력으로 입력"
          description="시작 날짜를 음력 월일로 골라요"
          checked={lunar !== null}
          onChange={(v) => dispatch({ type: "calendar", value: v ? "LUNAR" : "SOLAR" })}
        />
      </RowGroup>
    </>
  );
}
