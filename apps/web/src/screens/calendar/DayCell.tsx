"use client";
// (#484) 월 달력 날짜 칸(DayCell)과 넓은 화면 여러 날 일정 막대(WeekBar). CalendarScreen 에서 옮김. 격자는 MonthGrid.tsx
import { DotCluster, useWho } from "@/components/Participants";
import { IconHeart } from "@/components/icons";
import { occurrenceCellText, occurrenceTitle, type Occurrence } from "@/lib/anniversary";
import { cellDensity } from "@/lib/calendar-cell";
import { dateKeyOf, dowOf, formatDateKo, formatEventTime, parseKey, timeOf, type DateKey } from "@/lib/date";
import { holidayOf } from "@/lib/holidays";
import type { lunarCellText } from "@/lib/lunar";
import { phoneDayLanes, type BarPiece, type DayFit, type PackedWeek } from "@/lib/month-lanes";
import { barColors, chipColor, eventColors, splitBackground, withWho } from "@/lib/participants";
import { eventKey } from "@/lib/recurrence";
import type { Event } from "@/lib/types";

// 칩, 막대 한 줄 = 위 여백 2 + 높이 18
const ROW_PX = 20;
// 칸 위 1px 테두리 다음부터 첫 줄까지: 위 여백 4 + 숫자 줄 24 + 줄 위 여백 2
const FIRST_ROW_TOP = 30;

/**
 * 넓은 화면 여러 날 일정 막대 (#202). 한 주 줄 위에 걸친 칸만큼 한 줄로. 모양은 칩과 같다
 * (11/500, 높이 18, 모서리 5, 옅은 멤버 색 면 + 진한 글자). 진짜 시작, 끝만 둥글고 칸 안쪽 4px 에서 시작한다.
 * 앞 주에서 이어지거나 다음 주로 넘어가는 쪽은 칸 끝까지 각지게 붙인다. 제목은 조각마다 한 번
 */
export function WeekBar({ piece, className, onOpen }: { piece: BarPiece<Event>; className: string; onOpen: () => void }) {
  const ev = piece.event;
  const who = useWho();
  // 글자가 있는 막대라 칩 규칙 (#248 D-141): 첫 참여자 색 면 + 참여자 둘 이상이면 제목 앞 점 묶음. 일정 색(#343)이면 그 색 면, 점 없음
  const cluster = eventColors(ev).length >= 2;
  const l = piece.roundStart ? 4 : 0;
  const r = piece.roundEnd ? 4 : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      tabIndex={-1}
      aria-haspopup="dialog"
      aria-label={withWho(`${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}`, ev, who)}
      className={`pointer-events-auto absolute h-[18px] items-center gap-1 overflow-hidden px-1.5 text-left text-[11px] font-medium leading-[18px] whitespace-nowrap text-ink hover:brightness-95 ${
        piece.roundStart ? "rounded-l-[5px]" : ""
      } ${piece.roundEnd ? "rounded-r-[5px]" : ""} ${className}`}
      style={{
        top: FIRST_ROW_TOP + piece.lane * ROW_PX,
        left: `calc(${piece.col} * 100% / 7 + ${l}px)`,
        width: `calc(${piece.span} * 100% / 7 - ${l + r}px)`,
        // 칸 바탕(--tile)에 섞은 불투명 면: 일 상세 패널이 연 날의 --pri 테두리가 막대 글자를 세로로 가로지르지 않게 막대가 덮는다
        background: `color-mix(in srgb, ${chipColor(ev)} 18%, var(--tile))`,
      }}
    >
      {cluster && <DotCluster event={ev} />}
      <span className="truncate">
        {ev.title}
        {!ev.allDay && piece.roundStart ? ` ${timeOf(ev.startsAt)}` : ""}
      </span>
    </button>
  );
}

// 칸 모양은 칸 높이로 고른다 (폴더블.md 4-2): 넓은 화면에서 칸이 [container-type:size] 이고,
// 높이 ≥74px 이면 tall: 로 2줄, ≥94px 이면 taller: 로 3줄 (#423, globals.css). 줄은 위에서부터 여러 날 막대 레인(WeekBar 가 겹쳐 그림, 칸은 자리만) →
// 한 날 일정 칩(디자인규칙.md 2-2) → 넘치면 "+N개 더". 그보다 낮으면(아이폰 듀오 가로) 4px 막대 + 점 + 제목 한 줄.
// 폰(<600)은 칸 높이 104 에 이름 칩 4줄 (#355, 칩은 달력 격자 위 PhoneWeekChips 가 겹쳐 그리고 칸은 숫자, 기념일/공휴일 줄, "+N" 배지만).
// (#566) 음력 표시를 켜면 폰 칸은 숫자 아래 음력 한 줄(12)만큼 높다: 116 (PHONE_LUNAR_ROW, 칩 시작도 같이 내린다)
export function DayCell({
  dateKey,
  inMonth,
  isToday,
  isSelected,
  isAnchor,
  tabbable,
  events,
  anniversaries,
  lunar = null,
  lunarRow = false,
  week,
  col,
  fit2,
  fit3,
  phoneMore,
  loading,
  onPick,
  onFocus,
  onOpen,
}: {
  dateKey: DateKey;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  /** 일 상세 패널이 보여 주는 날 (--pri 2px 테두리, #331) */
  isAnchor: boolean;
  /** (#201) 격자의 Tab 정지점(roving tabindex) */
  tabbable: boolean;
  events: Event[];
  /** 그날 기념일 항목 (우선순위 순). 칸에는 첫 1개만 (#107) */
  anniversaries: Occurrence[];
  /** (#562) 음력 표시를 켰을 때 그날 음력 ("10.6", 윤달 "윤4.6"). 끄면 null */
  lunar?: ReturnType<typeof lunarCellText>;
  /** (#566) 음력 표시를 켰는지. 폰 칸 높이를 주마다 같게 (범위 밖 날로 lunar 가 null 이어도) */
  lunarRow?: boolean;
  /** 이 칸이 든 주의 막대 레인 (#202) */
  week: PackedWeek<Event>;
  /** 주 안 칸 (0=일) */
  col: number;
  /** 칩 2줄(tall), 3줄(taller) 일 때 이 칸의 칩 자리 */
  fit2: DayFit<Event>;
  fit3: DayFit<Event>;
  /** (#355) 폰 칸에서 못 그린 일정 수 (날짜 숫자 옆 "+N") */
  phoneMore: number;
  loading: boolean;
  onPick: () => void;
  onFocus: () => void;
  onOpen: (ev: Event) => void;
}) {
  const who = useWho();
  const p = parseKey(dateKey);
  const dow = dowOf(dateKey);
  const holiday = holidayOf(dateKey);
  const red = dow === 0 || dow === 6 || Boolean(holiday);
  // 선택 = 숫자 뒤 원(--sel-fill) + 흰 숫자, 선택 안 된 오늘 = 숫자만 --today-ink (D-57, 칸 면 채움 없음)
  const numClass = isSelected
    ? "bg-sel-fill font-bold text-on-pri"
    : isToday && inMonth
      ? "font-bold text-today-ink"
      : !inMonth
        ? red
          ? "font-medium text-holiday-faint"
          : "font-medium text-faint"
        : red
          ? "font-semibold text-holiday"
          : "font-semibold";
  // 기념일 줄 1개 (N주년 > N일 > 매년/원래 날짜). 공휴일과 겹치면 칸 글자는 기념일, 공휴일은 빨간 숫자로만 (3-6)
  const ann = anniversaries[0] ?? null;
  const annText = ann ? occurrenceCellText(ann) : null;
  const holidayText = ann ? null : holiday;
  const annLabel = anniversaries.length ? `, 기념일 ${anniversaries.map(occurrenceTitle).join(", ")}` : "";
  // (#201) 오늘은 aria-current="date", 선택은 gridcell aria-selected 로 알린다 (라벨에 ", 오늘" 을 붙이지 않는다)
  const lunarLabel = lunar ? `, ${lunar.label}` : "";
  const label = `${formatDateKo(dateKey, true)}${lunarLabel}${holiday ? `, ${holiday}` : ""}${annLabel}${events.length ? `, 일정 ${events.length}개` : ""}`;
  // (#566, D-298) 음력 글자 색: 읽히는 보조 글자 --mute(라이트 흰 칸 5.1:1, 다크 5.4:1), 초하루는 --soft 굵게.
  // 이번 달 밖 칸은 그 칸 날짜 숫자와 같은 --faint (예전 #562 의 --faint 8px 는 거의 안 보였다)
  const lunarClass = !inMonth ? "font-medium text-faint" : lunar?.first ? "font-bold text-soft" : "font-medium text-ink-2";

  // 점 모양: 여러 날 일정은 칸을 잇는 4px 막대(주 단위 레인, 최대 2줄), 나머지는 멤버 색 점(5px, 최대 3개, 막대가 있는 날도) + 첫 일정 제목.
  // 기념일/공휴일 줄이 있으면 막대는 1줄. 레인이 모자란 막대 일정은 그날 점으로 (QA3-M2). 일정 하나에 점 하나 + 넘치면 "+N" (#139)
  const lined = Boolean(annText || holidayText);
  const phone = phoneDayLanes(week, col, lined ? 1 : 2);
  const singles = week.singles[col];
  const density = cellDensity([...phone.overflow, ...singles]);
  const hasBar = phone.lanes.length > 0;
  // 숫자 아래 기념일/공휴일 줄 + 막대 + 점이면 칸 높이가 모자란다
  const crowded = hasBar && lined;
  const barHere = phone.lanes.find((s) => s !== null && s.col === col)?.event;
  const labelEvent = barHere ?? [...phone.overflow, ...singles].find((e) => dateKeyOf(e.startsAt) === dateKey || dow === 0) ?? null;
  // 칩 모양: 한 날 일정 칩은 막대가 없는 줄을 위에서부터 채운다(빈 위 레인도 쓴다, 폰 D-223 과 같은 규칙). tall 2줄, taller 3줄.
  // 줄 자리와 "+N개 더" 를 칸 높이별로 따로 센다 (month-lanes.ts fitWeek). 칩마다 높이별 줄을 CSS 변수로 넘긴다
  const shown2 = fit2.chips.length;
  const chips = singles.slice(0, Math.max(shown2, fit3.chips.length));
  const rowTop = (row: number | undefined) => `${(row ?? 0) * ROW_PX}px`;
  const moreVar = { "--more2": rowTop(1), "--more3": rowTop(2) } as React.CSSProperties;

  return (
    <div role="gridcell" aria-selected={isSelected} data-date={dateKey} className={`relative ${lunarRow ? "h-[116px]" : "h-[104px]"} border-t border-line fold:h-auto fold:min-h-0 fold:[container-type:size]`}>
      {/* (#201) 포커스 링은 칸 안쪽 2px(아래 span). 바깥으로 그리면 옆 칸 테두리, 겹쳐 그리는 칩, 달력 카드 가장자리에 잘린다.
          아래 탭(폰 독)에 가리지 않게 스크롤 여백을 둔다 */}
      <button
        type="button"
        onClick={onPick}
        onFocus={onFocus}
        tabIndex={tabbable ? 0 : -1}
        aria-current={isToday ? "date" : undefined}
        aria-expanded={isAnchor || undefined}
        aria-label={label}
        aria-haspopup="dialog"
        data-ring-inside=""
        className="peer absolute inset-0 scroll-mt-4 scroll-mb-[var(--dock-clearance)] hover:bg-hover/50"
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] hidden rounded-sm border-2 border-ink peer-focus-visible:block" />
      {isAnchor && <span aria-hidden="true" className="pointer-events-none absolute inset-px rounded-sm border-2 border-pri" />}
      {/* (#355) 폰: 4줄에 못 든 일정 수를 날짜 숫자 오른쪽 위 작은 배지로. 오른쪽 끝은 칸 안(좁은 칸은 숫자 원 귀퉁이에 살짝 겹친다) */}
      {phoneMore > 0 && !loading && (
        <b
          aria-hidden="true"
          className="pointer-events-none absolute top-[3px] right-[max(1px,calc(50%-26px))] z-[1] h-[13px] rounded-[7px] bg-line px-[3px] text-[9px] leading-[13px] font-bold whitespace-nowrap text-ink-2 ring-1 ring-paper fold:hidden"
        >
          +{phoneMore}
        </b>
      )}
      {/* (#566) 음력 (넓은 화면의 낮은 칸, 아이폰 듀오 가로 등): 칸 왼쪽 위 모서리 10px "10.6".
          폰은 숫자 아래 한 줄, 높은 칸(tall)은 숫자 줄 오른쪽 끝 (아래) */}
      {lunar && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute top-[3px] left-[3px] z-[1] hidden text-[10px] leading-3 tracking-[-0.02em] whitespace-nowrap tabular-nums fold:block tall:hidden ${lunarClass}`}
        >
          {lunar.text}
        </span>
      )}
      <div className="pointer-events-none relative flex h-full flex-col items-center overflow-hidden px-[3px] pt-1 text-center text-[13px] tall:items-stretch tall:px-1 tall:pb-1 tall:text-left tall:text-[12px]">
        <span className="relative flex max-w-full min-w-0 items-center tall:gap-1 @max-[84px]:tall:gap-0">
          <span className={`anim-pick grid size-[26px] shrink-0 place-items-center rounded-full leading-none max-fold:size-[22px] max-fold:text-[12px] tall:ml-0.5 tall:size-6 ${numClass}`}>{p.d}</span>
          {holidayText && (
            <span aria-hidden="true" className={`hidden truncate text-[11px] font-medium tall:inline ${inMonth ? "text-holiday" : "text-holiday-faint"}`}>
              {holidayText}
            </span>
          )}
          {/* 기념일도 공휴일처럼 숫자 옆 한 줄 (#202): 칩 줄을 쓰면 주마다 막대 레인 높이가 칸마다 달라진다 */}
          {annText && (
            <span
              aria-hidden="true"
              className={`hidden min-w-0 items-center gap-0.5 text-[11px] font-semibold whitespace-nowrap text-acc-ink tall:flex ${inMonth ? "" : "opacity-60"}`}
            >
              <IconHeart size={11} className="shrink-0" />
              <span className="truncate">{annText}</span>
            </span>
          )}
          {/* (#566) 높은 칸이 좁으면(폭 84 미만, 폴드 600 등) 10px, 자간을 좁히고 오른쪽 여백 없이 "11.24" 다섯 자가 들어가게.
              공휴일, 기념일 이름이 있는 칸은 폭 128 미만이면 이름이 한두 글자 조각으로 잘리므로 이름을 남기고 음력을 숨긴다 (D-61 우선순위) */}
          {lunar && (
            <span aria-hidden="true" className={`ml-auto hidden shrink-0 pr-1 text-[11px] leading-4 tracking-[-0.01em] whitespace-nowrap tabular-nums tall:inline @max-[84px]:pr-0 @max-[84px]:text-[10px] @max-[84px]:tracking-[-0.05em] ${lined ? "@max-[128px]:tall:hidden" : ""} ${lunarClass}`}>
              {lunar.text}
            </span>
          )}
        </span>
        {/* (#566, D-298) 폰: 날짜 숫자 바로 아래 가운데 한 줄 10px "10.6" (모든 날). 높이 12 를 칸이 늘려 받는다(116) */}
        {lunarRow && (
          <span aria-hidden="true" className={`block h-3 max-w-full shrink-0 truncate text-[10px] leading-3 tracking-[-0.02em] tabular-nums fold:hidden ${lunarClass}`}>
            {lunar?.text}
          </span>
        )}
        {holidayText && (
          <span
            aria-hidden="true"
            className={`relative block max-w-full shrink-0 truncate text-[10px] font-medium leading-3 max-fold:mt-[2px] max-fold:leading-[15px] tall:hidden ${inMonth ? "text-holiday" : "text-holiday-faint"}`}
          >
            {holidayText}
          </span>
        )}
        {/* 기념일 줄 (점 모양): 숫자 아래 10px --acc-ink 한 줄. 일정 제목 줄 위 */}
        {annText && (
          <span
            aria-hidden="true"
            className={`relative flex max-w-full shrink-0 items-center justify-center gap-px text-[10px] font-semibold leading-3 text-acc-ink max-fold:mt-[2px] max-fold:h-[15px] tall:hidden ${inMonth ? "" : "opacity-60"}`}
          >
            {/* 하트로 기념일임을 보인다 (주말 칸에서 공휴일처럼 보이지 않게, #140 L3) */}
            <IconHeart size={8} strokeWidth={2.6} className="shrink-0" />
            <span className="truncate">{annText}</span>
          </span>
        )}

        {/* 점 + 제목 한 줄: 넓은 화면의 낮은 칸(아이폰 듀오 가로 등)만. 폰은 이름 칩(#355, PhoneMonthChips) */}
        <span aria-hidden="true" className="relative block w-full max-fold:hidden tall:hidden">
          {loading ? null : (
            <>
              {phone.lanes.map((s, i) => {
                const gap = i === 0 ? "mt-[3px]" : "mt-px";
                if (!s) return <span key={`gap${i}`} className={`${gap} block h-1`} />;
                const start = s.isStart && s.col === col;
                const end = s.isEnd && s.col + s.span - 1 === col;
                return (
                  <span
                    key={s.key}
                    className={`${gap} block h-1 opacity-85 ${start ? "ml-1 rounded-l-[2px]" : "-ml-[3px]"} ${end ? "mr-1 rounded-r-[2px]" : "-mr-[3px]"}`}
                    // 참여자 색을 칸마다 왼쪽에서 오른쪽으로 나눈다 (4px 두께 방향은 안 보인다, D-141)
                    style={{ background: splitBackground(barColors(s.event), "to right") }}
                  />
                );
              })}
              {/* 막대가 있는 날도 그날 다른 일정은 점으로 (QA3-M2). 보통은 막대 아래 한 줄,
                  기념일/공휴일 줄까지 있으면 칸(52)에 넷째 줄이 안 들어가 막대 위에 칸 색 테두리를 두른 점으로 겹친다 */}
              {density.dots.length > 0 && (
                <span
                  className={`${!hasBar ? "mt-0.5" : crowded ? "absolute inset-x-0 top-[3px] h-1" : "mt-px"} flex ${crowded ? "" : "h-[7px]"} items-center justify-center gap-[3px]`}
                >
                  {density.dots.map((c, i) => (
                    <i key={i} className={`block size-[6px] rounded-full ${crowded ? "ring-[1.5px] ring-paper" : ""}`} style={{ background: c }} />
                  ))}
                  {/* +N = 점을 못 그린 일정 수, 숫자 없는 + = 참여자 점만 잘림 (#248 D-140) */}
                  {(density.more > 0 || density.cut) && <b className="text-[9px] font-bold leading-[7px] text-ink-2">+{density.more || ""}</b>}
                </span>
              )}
              {/* 기념일, 공휴일 줄이 있으면 칸 높이가 모자라 일정 제목 줄은 숨긴다 (막대, 점은 유지).
                  공휴일 줄은 shrink-0 이라야 truncate(overflow hidden) 때문에 높이 0 으로 눌려 사라지지 않는다 (#140 L2) */}
              {labelEvent && !annText && !holidayText && <span className="mx-auto mt-px hidden max-w-[94%] truncate fold:block text-[10px] font-medium leading-3 text-ink-2">{labelEvent.title}</span>}
            </>
          )}
        </span>

        {/* 한 날 일정 칩 (제목 + 시간). 위는 여러 날 막대 레인 자리(막대는 WeekBar 가 주 줄 위에 그린다).
            누르면 그날 상세 → 일정 상세 */}
        {/* (#201) 칩은 마우스, 터치 지름길이다. 키보드, 스크린리더는 칸(Enter → 그날 상세 목록)으로 간다 */}
        <span aria-hidden="true" className="relative hidden w-full tall:block" style={moreVar}>
          {chips.map((ev, i) => (
            <button
              key={eventKey(ev)}
              type="button"
              onClick={() => onOpen(ev)}
              tabIndex={-1}
              aria-haspopup="dialog"
              aria-label={withWho(`${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}`, ev, who)}
              className={`pointer-events-auto absolute inset-x-0 top-[var(--top2)] mt-0.5 h-[18px] items-center gap-1 overflow-hidden rounded-[5px] px-1.5 text-left text-[11px] font-medium leading-[18px] whitespace-nowrap text-ink hover:brightness-95 taller:top-[var(--top3)] ${
                i < shown2 ? "flex" : "hidden taller:flex"
              }`}
              style={
                {
                  "--top2": rowTop(fit2.rows[i]),
                  "--top3": rowTop(fit3.rows[i]),
                  background: `color-mix(in srgb, ${chipColor(ev)} 18%, transparent)`,
                } as React.CSSProperties
              }
            >
              {/* 첫 참여자 색 면 + 참여자 둘 이상이면 제목 앞 점 묶음 (#248 7-2) */}
              {eventColors(ev).length >= 2 && <DotCluster event={ev} />}
              <span className="truncate">
                {ev.title}
                {!ev.allDay && dateKeyOf(ev.startsAt) === dateKey ? ` ${timeOf(ev.startsAt)}` : ""}
              </span>
            </button>
          ))}
          {/* "+N개 더" 는 마지막 줄 (2줄이면 1번, 3줄이면 2번 줄) */}
          {fit2.more > 0 && <span aria-hidden="true" className="absolute inset-x-0 top-[var(--more2)] mt-0.5 block truncate whitespace-nowrap px-1 text-[11px] font-medium leading-4 text-ink-2 taller:hidden">+{fit2.more}<span className="@max-[60px]:hidden">개 더</span></span>}
          {fit3.more > 0 && <span aria-hidden="true" className="absolute inset-x-0 top-[var(--more3)] mt-0.5 hidden truncate whitespace-nowrap px-1 text-[11px] font-medium leading-4 text-ink-2 taller:block">+{fit3.more}<span className="@max-[60px]:hidden">개 더</span></span>}
        </span>
      </div>
    </div>
  );
}
