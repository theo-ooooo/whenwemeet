// (#355, C안) 폰(<600) 월 달력 한 주 줄의 일정 이름 칩. 배치(줄, "+N")는 lib/month-lanes.ts phoneWeek
// - 칸당 4줄, 칩 높이 15 + 간격 2, 글자 10/600, 시각 없음
// - 하루짜리 = 일정 색 26%(다크 32%, --day-chip-mix)를 --tile 에 섞은 면 + 먹색 글자, 왼쪽 줄 없음
// - 여러 날 = 일정 색 그대로 이어진 막대 + --on-member 글자. 주 조각마다 제목 한 번(그 주 첫 칸)
// - 색은 일정 색, 자동이면 첫 참여자 색 (chipColor, #343)
// - 긴 이름은 칩 끝 8px 에서 글자만 흐려지며 잘린다 (… 안 씀)
// 칩은 그림일 뿐이다(aria-hidden, 누르기 없음). 누르면 아래 날짜 칸 버튼이 받아 그날 상세를 연다
import { chipColor } from "@/lib/participants";
import type { PhoneChip } from "@/lib/month-lanes";
import type { Event } from "@/lib/types";

const CHIP_H = 15;
const CHIP_GAP = 2;
/** 주 줄 위에서 첫 줄까지: 칸 위 테두리 1 + 위 여백 4 + 날짜 숫자 22 + 2 */
const FIRST_TOP = 29;
/** (#566) 음력 표시를 켜면 숫자 아래 음력 한 줄(10px 글자, 줄 높이 12)만큼 칩을 내린다. 칸도 104 → 116 (DayCell) */
const PHONE_LUNAR_ROW = 12;
const FADE_END = "linear-gradient(90deg, #000 calc(100% - 8px), transparent)";

function PhoneChipView({ chip, top0 }: { chip: PhoneChip<Event>; top0: number }) {
  const color = chipColor(chip.event);
  // 진짜 시작, 끝만 칸 안쪽 1px 에서 둥글게. 앞 주에서 이어지거나 다음 주로 넘어가는 쪽은 칸 끝까지 각지게
  const l = chip.roundStart ? 1 : 0;
  const r = chip.roundEnd ? 1 : 0;
  return (
    <span
      data-chip={chip.multi ? "multi" : "day"}
      className={`absolute overflow-hidden px-[3px] text-[10px] font-semibold tracking-[-0.03em] whitespace-nowrap ${
        chip.multi ? "bg-(--chip-c) text-on-member" : "bg-[color-mix(in_srgb,var(--chip-c)_var(--day-chip-mix),var(--tile))] text-ink"
      } ${chip.roundStart ? "rounded-l-[4px]" : ""} ${chip.roundEnd ? "rounded-r-[4px]" : ""}`}
      style={
        {
          "--chip-c": color,
          top: top0 + chip.lane * (CHIP_H + CHIP_GAP),
          height: CHIP_H,
          lineHeight: `${CHIP_H}px`,
          left: `calc(${chip.col} * 100% / 7 + ${l}px)`,
          width: `calc(${chip.span} * 100% / 7 - ${l + r}px)`,
        } as React.CSSProperties
      }
    >
      <span className="block overflow-hidden" style={{ maskImage: FADE_END, WebkitMaskImage: FADE_END }}>
        {chip.event.title}
      </span>
    </span>
  );
}

/** 한 주 줄(칸 7개 위에 겹친 칸) 의 칩들 */
export function PhoneWeekChips({ chips, lunarRow = false }: { chips: readonly PhoneChip<Event>[]; lunarRow?: boolean }) {
  const top0 = FIRST_TOP + (lunarRow ? PHONE_LUNAR_ROW : 0);
  return (
    <div className="relative">
      {chips.map((c) => (
        <PhoneChipView key={`${c.key}@${c.col}`} chip={c} top0={top0} />
      ))}
    </div>
  );
}
