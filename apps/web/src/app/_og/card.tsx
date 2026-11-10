// 공유 미리보기 카드 그림 (#159). next/og(satori) 용 JSX 라 Tailwind 대신 인라인 style, 자식이 둘 이상이면 display:flex
// 색은 디자인 토큰 D-57 (라이트): 바탕 --bg, 타일 --tile, 글자 --ink/--mute, 강조 --sel-fill/--acc-ink, 주말 --holiday, 멤버 --m1~
import type { ReactNode } from "react";
import { freeDayOf, monthGrid, TEAM_NAME_WIDTH } from "@/lib/og";

export const OG_SIZE = { width: 1200, height: 630 };

const C = {
  bg: "#F4F3F1",
  tile: "#FFFFFF",
  ink: "#26252A",
  mute: "#6C6C70",
  faint: "#C7C7CC",
  line: "#ECEBE8",
  sel: "#C8432D",
  accInk: "#C2402A",
  blush: "#FFE1D9",
  holiday: "#B4475C",
  members: ["#2563EB", "#A16207", "#0B7A8A", "#7C3AED", "#15803D"],
};

/** 2026 심볼 (components/Logo.tsx Symbol 과 같은 치수 비율, 브랜드 고정색) */
function BrandSymbol({ size }: { size: number }) {
  const k = size / 40;
  const sq = 23 * k;
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size }}>
      <div style={{ position: "absolute", left: 3 * k, top: 3 * k, width: sq, height: sq, borderRadius: 8 * k, background: "#FF3D1F" }} />
      <div style={{ position: "absolute", left: 14 * k, top: 14 * k, width: sq, height: sq, borderRadius: 8 * k, background: "#1F5BFF" }} />
      <div
        style={{
          position: "absolute",
          left: 14 * k,
          top: 14 * k,
          width: 12 * k,
          height: 12 * k,
          borderRadius: `0 0 ${8 * k}px 0`,
          background: "#9A1DFF",
        }}
      />
    </div>
  );
}

function BrandMark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <BrandSymbol size={46} />
      <span style={{ fontSize: 30, fontWeight: 700, color: C.ink, letterSpacing: "-0.03em" }}>언제볼까</span>
    </div>
  );
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 날짜별 멤버 일정 점 (그림용 고정 패턴) */
function dotsOf(day: number, free: number): string[] {
  if (day === free) return [];
  const seed = (day * 7 + 3) % 11;
  if (seed < 4) return [C.members[seed % 3]];
  if (seed < 6) return [C.members[0], C.members[(seed % 2) + 1]];
  if (seed === 6) return [C.members[0], C.members[1], C.members[2]];
  return [];
}

/** 오른쪽 달력 타일. 오늘이 있는 달(KST), 오늘 다음 토요일을 "모두 비는 날" 로 칠한다 */
function MiniCalendar({ now }: { now: Date }) {
  const { month, today, cells } = monthGrid(now);
  const free = freeDayOf(cells, today);
  const CELL = 62;
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 7 * CELL + 56,
        padding: "30px 28px 34px",
        background: C.tile,
        borderRadius: 32,
        boxShadow: "0 30px 60px rgba(120, 52, 36, 0.12), 0 2px 6px rgba(38, 37, 42, 0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 18px" }}>
        <span style={{ fontSize: 30, fontWeight: 700, color: C.ink, letterSpacing: "-0.03em" }}>{month}월</span>
        <div style={{ display: "flex" }}>
          {C.members.slice(0, 3).map((c, i) => (
            <div
              key={c}
              style={{ width: 30, height: 30, borderRadius: 15, background: c, border: `3px solid ${C.tile}`, marginLeft: i ? -9 : 0 }}
            />
          ))}
        </div>
      </div>
      <div style={{ display: "flex" }}>
        {WEEKDAYS.map((w, i) => (
          <span
            key={w}
            style={{
              width: CELL,
              display: "flex",
              justifyContent: "center",
              fontSize: 17,
              fontWeight: 500,
              color: i === 0 || i === 6 ? C.holiday : C.mute,
              paddingBottom: 8,
            }}
          >
            {w}
          </span>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: "flex" }}>
          {week.map((c, ci) => {
            const isFree = c.day === free;
            const isToday = c.day === today;
            const weekend = c.weekday === 0 || c.weekday === 6;
            const dots = c.day ? dotsOf(c.day, free) : [];
            return (
              <div key={ci} style={{ width: CELL, height: 60, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 6 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isFree ? C.sel : "transparent",
                    fontSize: 20,
                    fontWeight: isFree || isToday ? 700 : 500,
                    color: isFree ? "#FFFFFF" : isToday ? C.accInk : weekend ? C.holiday : C.ink,
                  }}
                >
                  {c.day ?? ""}
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 3, height: 7 }}>
                  {dots.map((d, i) => (
                    <div key={i} style={{ width: 7, height: 7, borderRadius: 4, background: d }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** 달력 위에 걸친 "모두 비는 시간" 쪽지. 서비스의 핵심 장면 */
function FreeNote({ now }: { now: Date }) {
  const { cells, today, month } = monthGrid(now);
  const free = freeDayOf(cells, today);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "18px 26px 18px 20px",
        background: C.ink,
        borderRadius: 22,
        boxShadow: "0 18px 40px rgba(38, 37, 42, 0.22)",
      }}
    >
      <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: "#FF8670" }} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 18, fontWeight: 500, color: "#B9B8BE" }}>
          {month}월 {free}일 토요일
        </span>
        <span style={{ fontSize: 26, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.02em" }}>오후 2시부터 모두 비어요</span>
      </div>
    </div>
  );
}

/** 바탕 + 왼쪽 글 칸 + 오른쪽 기울인 달력. 달력은 오른쪽 아래로 잘려 나가게 둔다 */
export function OgFrame({ children, now }: { children: ReactNode; now: Date }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        background: C.bg,
        fontFamily: "Pretendard",
        overflow: "hidden",
      }}
    >
      {/* 달력 뒤 옅은 코랄 원: 따뜻한 빛만, 무늬로 쓰지 않는다 */}
      <div
        style={{
          position: "absolute",
          right: -160,
          top: -120,
          width: 760,
          height: 760,
          borderRadius: 380,
          background: "radial-gradient(circle at center, #FFE1D9 0%, rgba(255, 225, 217, 0.6) 45%, rgba(244, 243, 241, 0) 72%)",
        }}
      />
      <div style={{ position: "absolute", right: -18, top: 70, display: "flex", transform: "rotate(-5deg)" }}>
        <MiniCalendar now={now} />
      </div>
      <div style={{ position: "absolute", right: 64, top: 462, display: "flex", transform: "rotate(-5deg)" }}>
        <FreeNote now={now} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 660,
          display: "flex",
          flexDirection: "column",
          padding: "64px 0 64px 76px",
        }}
      >
        <BrandMark />
        {children}
      </div>
    </div>
  );
}

export type OgLine = { text: string; size?: number; gap?: number; clamp?: number; wordBreak?: "keep-all" | "break-all" };

/** 글 칸 아래쪽 묶음: 위에 작은 말, 큰 제목(줄마다 크기 지정), 아래 말, 버튼 모양 칩.
 *  satori 는 Fragment 자식의 세로 배치를 어겨서 줄마다 div 로 그린다 */
export function OgCopy({
  kicker,
  lines,
  titleSize,
  lead,
  chip,
}: {
  kicker?: string;
  lines: OgLine[];
  titleSize: number;
  lead: string;
  chip: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
      {kicker ? (
        <div style={{ display: "flex", marginBottom: 22 }}>
          <div
            style={{
              display: "flex",
              padding: "8px 16px",
              borderRadius: 12,
              border: `2px solid ${C.line}`,
              background: "rgba(255,255,255,0.7)",
              fontSize: 22,
              fontWeight: 500,
              color: C.mute,
            }}
          >
            {kicker}
          </div>
        </div>
      ) : null}
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            // 줄 수 제한은 block 에서만 (satori lineClamp)
            ...(l.clamp ? { display: "block", lineClamp: l.clamp } : { display: "flex" }),
            maxWidth: TEAM_NAME_WIDTH,
            marginTop: i ? (l.gap ?? 0) : 0,
            fontSize: l.size ?? titleSize,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: (l.size ?? titleSize) >= 70 ? "-0.045em" : "-0.03em",
            color: C.ink,
            wordBreak: l.wordBreak ?? "keep-all",
          }}
        >
          {l.text}
        </div>
      ))}
      <div style={{ display: "flex", marginTop: 22, fontSize: 28, fontWeight: 500, lineHeight: 1.4, color: C.mute, letterSpacing: "-0.02em" }}>
        {lead}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 36 }}>
        <div
          style={{
            display: "flex",
            padding: "16px 32px",
            borderRadius: 18,
            background: C.sel,
            color: "#FFFFFF",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          {chip}
        </div>
        <div style={{ display: "flex", fontSize: 22, fontWeight: 500, color: C.mute }}>whenwemeet.day</div>
      </div>
    </div>
  );
}
