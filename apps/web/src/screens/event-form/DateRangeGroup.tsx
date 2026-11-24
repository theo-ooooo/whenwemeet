"use client";
// (#497) 일정 폼 2. 종일, 시작, 종료. EventFormScreen 에서 옮김
import { DatePicker, TimePicker } from "@/components/pickers";
import { InlineError, RowGroup, ToggleRow } from "@/components/ui";
import type { DraftAction, EventDraft } from "@/lib/event-draft";

type Props = {
  draft: EventDraft;
  dispatch: React.Dispatch<DraftAction>;
  touched: boolean;
  rangeError: string | null;
};

export function DateRangeGroup({ draft, dispatch, touched, rangeError }: Props) {
  const { allDay, startDate, startTime, endDate, endTime } = draft;
  return (
    <RowGroup>
      <ToggleRow label="종일" checked={allDay} onChange={(v) => dispatch({ type: "allDay", value: v })} />
      {(
        [
          { key: "start", label: "시작", date: startDate, time: startTime },
          { key: "end", label: "종료", date: endDate, time: endTime },
        ] as const
      ).map((row) => (
        <div key={row.key} className="flex min-h-12 items-center gap-2 py-1.5">
          <span aria-hidden="true" className="w-9 shrink-0 text-[14px] text-ink-2">
            {row.label}
          </span>
          <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5">
            <DatePicker
              look="chip"
              label={`${row.label} 날짜`}
              value={row.date}
              min={row.key === "end" ? startDate : undefined}
              onChange={(v) =>
                dispatch(row.key === "start" ? { type: "start", date: v, time: startTime } : { type: "end", date: v, time: endTime, by: "date" })
              }
            />
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
      ))}
      {rangeError && (
        <div className="py-2">
          {touched ? <InlineError>{rangeError}</InlineError> : <p className="t-sub">{rangeError}</p>}
        </div>
      )}
    </RowGroup>
  );
}
