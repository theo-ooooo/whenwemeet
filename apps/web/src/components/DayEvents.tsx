"use client";
// (#378 B) 하루 일정 목록 (일 상세 C안). 폰 일 상세(DayView)와 넓은 화면 오른쪽 패널(DayPanel)이 같이 쓴다.
// 일정 줄은 공통 EventRow(시각 한 번, 굵은 색 막대, 장소, 참여자는 모두가 아닐 때만, 내 참석 알약, 지난 일정 흐리게).
// 오늘이면 지난 일정과 아직 시작 안 한 일정 사이에 "지금 오후 2:10" 줄. 누르면 같은 자리에서 일정 상세(onOpen)
import { EventList, EventRow } from "./EventRow";
import { useWho } from "./Participants";
import { clockText } from "@/lib/event-row";
import { nowLineIndex } from "@/lib/day-view";
import { eventKey } from "@/lib/recurrence";
import type { DateKey } from "@/lib/date";
import type { Event } from "@/lib/types";

type Props = {
  events: Event[];
  date: DateKey;
  /** 지금 (ms). 지난 일정을 흐리게 한다. today 일 때만 "지금" 줄 */
  now: number;
  today: DateKey;
  onOpen: (ev: Event) => void;
  label?: string;
  className?: string;
};

/** 새 탭, 가운데 클릭은 링크 그대로 둔다 (그 밖은 같은 자리에서 연다) */
const plainClick = (e: React.MouseEvent) => !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);

export function DayEventList({ events, date, now, today, onOpen, label, className = "" }: Props) {
  const who = useWho();
  const line = date === today ? nowLineIndex(events, now) : null;
  const nowRow = (
    // 지금 줄은 바로 아래 줄의 구분선을 대신한다 (다음 li 의 ::after 를 숨긴다)
    <li key="now" className="flex h-5 items-center gap-1.5 px-3.5 [&+li]:after:hidden!">
      <span className="shrink-0 text-[11px] font-bold leading-4 text-acc-ink">지금 {clockText(now)}</span>
      <i aria-hidden="true" className="block h-[1.5px] flex-1 rounded-full bg-pri" />
    </li>
  );
  return (
    <EventList label={label} className={className}>
      {events.map((ev, i) => [
        i === line ? nowRow : null,
        <EventRow
          key={eventKey(ev)}
          event={ev}
          who={who}
          day={date}
          now={now}
          resolvePlace
          onClick={(e) => {
            if (!plainClick(e)) return;
            e.preventDefault();
            onOpen(ev);
          }}
        />,
      ])}
      {line === events.length && nowRow}
    </EventList>
  );
}
