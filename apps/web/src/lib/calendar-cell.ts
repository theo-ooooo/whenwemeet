// 폰 달력 칸의 일정 밀도 표시 (#139, #248 D-140).
// 일정 순서대로 참여자마다 점(참여자 없음은 회색 점 1개)을 이어 붙여 앞 max 개만 그린다.
// - 점을 하나도 못 그린 일정이 있으면 "+N" (그 일정 수)
// - 일정은 다 보였지만 참여자 점이 잘렸으면 숫자 없는 "+" (cut)
// 예전(#139)에는 일정 하나에 등록자 색 점 하나였다
import { MUTE, participantColors } from "./participants";
import type { Event } from "./types";

type CellEvent = Pick<Event, "creator" | "participants">;

/** dots 는 화면 색(CSS 값) */
export type CellDensity = { dots: string[]; more: number; cut: boolean };

export function cellDensity(events: readonly CellEvent[], max = 3): CellDensity {
  const dots: string[] = [];
  let more = 0;
  let cut = false;
  for (const ev of events) {
    const colors = participantColors(ev);
    const own = colors.length ? colors : [MUTE];
    const room = max - dots.length;
    if (room <= 0) {
      more += 1;
      continue;
    }
    if (own.length > room) cut = true;
    dots.push(...own.slice(0, room));
  }
  return { dots, more, cut: more === 0 && cut };
}
