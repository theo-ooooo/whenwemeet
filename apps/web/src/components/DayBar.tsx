"use client";
// (#378) 하루 막대: 그날 정한 창(기본 8~23시) 안에서 "모두 비는 시간" 은 코랄 막대, 바쁜 시간은 중립 면 (디자인규칙.md 8-5, 일 상세 C안).
//   머리 한 줄: 왼쪽 title(12 `--mute`), 오른쪽 "모두 빔 4시간 30분"(값 `--acc-ink` 700. 멤버 둘이면 "둘 다 빔")
//   막대 22, 모서리 7. 바쁜 면은 --faint 를 타일에 60% 섞은 중립 면, 빈 구간은 --pri 85%
//   눈금(10 `--mute`), 오늘이면 "지금" 선(먹색 2px + 위 작은 "지금")
//   멤버별 얇은 막대(8, 아바타 16 + 그 사람의 바쁜 시간), 멤버가 둘 이상일 때
// 빈 구간은 onSelect 가 있으면 버튼: 누른 자리를 30분 단위로 내린 시각(키보드는 구간 시작)으로 onSelect(start ms). 배치 계산은 lib/day-bar.ts
import { Avatar } from "./ui";
import {
  barSegments,
  barTicks,
  busyMarks,
  DEFAULT_FROM_HOUR,
  DEFAULT_TO_HOUR,
  dayWindow,
  everyoneFree,
  nowLeft,
  pickStart,
  timeAt,
  totalMinutes,
  type Interval,
} from "@/lib/day-bar";
import { formatMinutes, type DateKey } from "@/lib/date";
import { clockRangeText, clockText } from "@/lib/event-row";
import type { Member } from "@/lib/types";

export type DayBarMember = { member: Member; busy: Interval[] };

type Props = {
  date: DateKey;
  fromHour?: number;
  toHour?: number;
  /** 멤버별 바쁜 구간 (lib/day-bar busyByMember). 모두 비는 시간은 여기서 계산한다 */
  members: DayBarMember[];
  /** 모두 비는 구간을 서버 값(free-slots)으로 줄 때. 없으면 members 로 계산 */
  free?: Interval[];
  /** 머리 왼쪽 글자. 기본 "이날 하루" */
  title?: string;
  /** 멤버별 얇은 막대. 기본은 멤버가 둘 이상일 때 */
  showMembers?: boolean;
  /** 지금 (ms). 창 안이면 "지금" 선 */
  now?: number;
  /** 빈 구간을 누르면 그 시각(ms)으로 */
  onSelect?: (start: number) => void;
  /** 요약 글자("둘 다 빔", "모두 빔")를 가를 사람 수. 기본은 members 수 (free 만 줄 때 넘긴다). 1 이면 "비는 시간" (개인 달력) */
  memberCount?: number;
  /** 카드 면과 안쪽 여백 없이 (넓은 화면 패널처럼 이미 흰 면 위에 놓일 때) */
  bare?: boolean;
  /** 머리 한 줄(title, 요약)을 그리지 않는다 (빈 시간 결과 카드처럼 위에 자기 머리가 있을 때). 읽기 이름은 그대로 */
  hideHead?: boolean;
  className?: string;
};

const BUSY_FILL = "color-mix(in srgb, var(--faint) 60%, var(--tile))";

export function DayBar({
  date,
  fromHour = DEFAULT_FROM_HOUR,
  toHour = DEFAULT_TO_HOUR,
  members,
  free,
  title = "이날 하루",
  showMembers,
  now,
  onSelect,
  memberCount,
  bare = false,
  hideHead = false,
  className = "",
}: Props) {
  const win = dayWindow(date, fromHour, toHour);
  const freeList = free ?? everyoneFree(members.map((m) => m.busy), win);
  const freeSegs = barSegments(freeList, win).filter((s) => s.kind === "free");
  const freeMin = totalMinutes(freeSegs);
  const ticks = barTicks(fromHour, toHour);
  const nowAt = now === undefined ? null : nowLeft(win, now);
  const rows = showMembers ?? members.length > 1;
  // 혼자(개인 달력)면 "둘 다", "모두" 없이 (#378 B: 개인 달력은 내 바쁜 시간과 빈 시간만)
  const people = memberCount ?? members.length;
  const who = people === 1 ? "" : people === 2 ? "둘 다 " : "모두 ";
  const freeText = (s: Interval) => `${clockRangeText(s.start, s.end)} ${who}비어요`;
  const summary = freeMin > 0 ? (who ? `${who}빔` : "비는 시간") : `${who}비는 시간 없음`;

  return (
    <div role="group" aria-label={`${title}, ${summary}${freeMin > 0 ? ` ${formatMinutes(freeMin)}` : ""}`} className={`${bare ? "" : "rounded-xl bg-paper px-3.5 pb-2.5 pt-3"} ${className}`}>
      {!hideHead && (
        <div className="flex items-baseline justify-between gap-3 text-[12px] leading-4 text-ink-2">
          <span className="min-w-0 truncate">{title}</span>
          <span className="shrink-0">
            {summary}
            {freeMin > 0 && <b className="ml-1 font-bold text-acc-ink">{formatMinutes(freeMin)}</b>}
          </span>
        </div>
      )}

      <div className={`relative ${nowAt !== null ? "mt-4" : hideHead ? "" : "mt-2"}`}>
        {nowAt !== null && (
          <span
            aria-hidden="true"
            className="absolute -top-3.5 z-10 -translate-x-1/2 text-[10px] font-bold leading-3 text-ink"
            style={{ left: `clamp(10px, ${nowAt}%, calc(100% - 10px))` }}
          >
            지금
          </span>
        )}
        <div className="relative h-[22px] overflow-hidden rounded-[7px]" style={{ background: BUSY_FILL }}>
          {freeSegs.map((s) => (
            <i key={s.start} data-free className="absolute inset-y-0 bg-pri opacity-85" style={{ left: `${s.left}%`, width: `${s.width}%` }}>
              {!onSelect && <span className="sr-only">{freeText(s)}</span>}
            </i>
          ))}
        </div>
        {onSelect && (
          // 누르는 칸은 막대(22) 위아래로 44 까지 넓힌 투명 버튼 (막대는 모서리를 자르느라 overflow-hidden 이라 따로 둔다)
          <div className="absolute inset-x-0 top-1/2 h-11 -translate-y-1/2">
            {freeSegs.map((s) => (
              <button
                key={s.start}
                type="button"
                aria-label={`${freeText(s)}, 이 시간에 일정 추가`}
                onClick={(e) => {
                  const box = e.currentTarget.parentElement!.getBoundingClientRect();
                  // 키보드(Enter, Space)로 누르면 detail 0 → 구간 시작
                  const at = e.detail === 0 || box.width === 0 ? undefined : timeAt(win, (e.clientX - box.left) / box.width);
                  onSelect(pickStart(s, at));
                }}
                className="absolute inset-y-0 rounded-[7px]"
                style={{ left: `${s.left}%`, width: `${s.width}%` }}
              />
            ))}
          </div>
        )}
        {nowAt !== null && (
          <i
            aria-hidden="true"
            data-now
            className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
            style={{ left: `${nowAt}%` }}
          />
        )}
      </div>
      {nowAt !== null && <span className="sr-only">지금 {clockText(now!)}</span>}

      <div aria-hidden="true" className="relative mt-1 h-3 text-[10px] leading-3 text-ink-2">
        {ticks.map((t, i) => (
          <span
            key={t.hour}
            className="absolute top-0 whitespace-nowrap"
            style={{ left: `${t.left}%`, transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
          >
            {t.hour}
          </span>
        ))}
      </div>

      {rows && (
        <ul className="mt-2 space-y-1.5">
          {members.map(({ member, busy }, i) => (
            <li key={`${member.userId ?? "x"}-${i}`} className="flex items-center gap-2">
              <Avatar member={member} color={member.color} size={16} />
              <span className="sr-only">
                {member.displayName} 바쁜 시간 {busy.length === 0 ? "없음" : busy.map((b) => clockRangeText(b.start, b.end)).join(", ")}
              </span>
              <span aria-hidden="true" className="relative h-2 flex-1 overflow-hidden rounded-full bg-hover">
                {busyMarks(busy, win).map((b) => (
                  <i key={b.start} className="absolute inset-y-0" style={{ left: `${b.left}%`, width: `${b.width}%`, background: BUSY_FILL }} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
