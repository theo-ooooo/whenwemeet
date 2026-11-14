// 공유 미리보기 카드 그림 (#159). next/og(satori) 용 JSX 라 Tailwind 대신 인라인 style, 자식이 둘 이상이면 display:flex
// 색은 디자인 토큰 D-57 (라이트): 바탕 --tile(흰색), 휴대폰 화면 --bg, 글자 --ink/--mute, 강조 --sel-fill, 주말 --holiday, 멤버 --m1~
import type { ReactNode } from "react";
import { freeDayOf, monthGrid, TEAM_NAME_WIDTH } from "@/lib/og";

export const OG_SIZE = { width: 1200, height: 630 };

const C = {
  bg: "#F4F3F1",
  tile: "#FFFFFF",
  ink: "#26252A",
  mute: "#6C6C70",
  line: "#ECEBE8",
  blush: "#FFE1D9",
  holiday: "#B4475C",
  members: ["#2563EB", "#A16207", "#0B7A8A", "#7C3AED", "#15803D"],
  sel: "#C8432D",
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

/** 앱 일정 칩 색 (연한 칩: 글자 진하게, 진한 칩: 흰 글자) */
const CHIP = {
  soft: { bg: "#D6E4FB", ink: "#1E2A3B" },
  purple: { bg: "#E7DDFB", ink: "#2B1F45" },
  blue: { bg: "#3B82F6", ink: "#FFFFFF" },
  pink: { bg: "#EC4899", ink: "#FFFFFF" },
};
const LABELS = ["저녁 약속", "치과", "독서 모임", "요가", "스터디", "영화", "생일 파티", "카페 작업", "같이 요리"];

/** 날짜별 일정 칩 (그림용 고정 패턴). 모두 비는 날은 비워 둔다 */
function chipsOf(day: number, free: number): { label: string; c: { bg: string; ink: string } }[] {
  if (day === free) return [];
  const seed = (day * 7 + 3) % 11;
  const label = (k: number) => LABELS[(day + k) % LABELS.length];
  if (seed < 3) return [{ label: label(0), c: CHIP.soft }];
  if (seed === 3) return [{ label: label(0), c: CHIP.purple }];
  if (seed === 4) return [{ label: label(0), c: CHIP.soft }, { label: label(3), c: CHIP.soft }];
  if (seed === 5) return [{ label: label(1), c: CHIP.pink }];
  return [];
}

const SCREEN_W = 308;
const COL = 40;

/** 휴대폰 속 팀 달력 화면. 오늘이 있는 달(KST), 오늘은 코랄 원, 모두 비는 날은 옅은 코랄 칸 */
function CalendarScreen({ now, team }: { now: Date; team: string }) {
  const { month, today, cells } = monthGrid(now);
  const free = freeDayOf(cells, today);
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  // 여러 날 막대는 오늘이 있는 주에 (아래 주는 쪽지에 가린다)
  const tripWeek = weeks.findIndex((w) => w.some((c) => c.day === today));
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "0 12px" }}>
      <div style={{ display: "flex", alignItems: "center", height: 44 }}>
        <BrandSymbol size={28} />
        <span style={{ marginLeft: 8, fontSize: 19, fontWeight: 700, color: C.ink, letterSpacing: "-0.03em", maxWidth: 170, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {team}
        </span>
        <div style={{ display: "flex", marginLeft: "auto" }}>
          {C.members.slice(0, 3).map((c, i) => (
            <div key={c} style={{ width: 26, height: 26, borderRadius: 13, background: c, border: `2.5px solid ${C.bg}`, marginLeft: i ? -8 : 0 }} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", height: 46 }}>
        <span style={{ fontSize: 21, fontWeight: 700, color: C.ink, letterSpacing: "-0.03em" }}>{month}월</span>
        <div style={{ display: "flex", marginLeft: "auto", padding: 3, borderRadius: 10, background: C.tile }}>
          <span style={{ display: "flex", padding: "3px 10px", borderRadius: 8, background: C.ink, color: "#FFFFFF", fontSize: 12, fontWeight: 700 }}>월</span>
          <span style={{ display: "flex", padding: "3px 10px", fontSize: 12, fontWeight: 500, color: C.mute }}>주</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", width: COL * 7 + 4, padding: "4px 2px 0", borderRadius: 16, background: C.tile }}>
        <div style={{ display: "flex", height: 26, alignItems: "center", borderBottom: `1px solid ${C.line}` }}>
          {WEEKDAYS.map((w, i) => (
            <span key={w} style={{ width: COL, display: "flex", justifyContent: "center", fontSize: 11, fontWeight: 500, color: i === 0 || i === 6 ? C.holiday : C.mute }}>
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "flex", position: "relative", height: 76, borderBottom: `1px solid ${C.line}` }}>
            {week.map((c, ci) => {
              const isToday = c.day === today;
              const weekend = c.weekday === 0 || c.weekday === 6;
              return (
                <div
                  key={ci}
                  style={{
                    width: COL,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: 5,
                    background: c.day === free ? C.blush : "transparent",
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isToday ? C.sel : "transparent",
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? "#FFFFFF" : weekend ? C.holiday : C.ink,
                    }}
                  >
                    {c.day ?? ""}
                  </div>
                  {c.day
                    ? chipsOf(c.day, free).map((chip, k) => (
                        <div
                          key={k}
                          style={{
                            display: "flex",
                            width: COL - 4,
                            height: 14,
                            marginTop: 3,
                            padding: "0 3px",
                            borderRadius: 4,
                            background: chip.c.bg,
                            color: chip.c.ink,
                            fontSize: 9,
                            fontWeight: 500,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {chip.label}
                        </div>
                      ))
                    : null}
                </div>
              );
            })}
            {wi === tripWeek ? (
              <div
                style={{
                  position: "absolute",
                  left: COL * 2 + 2,
                  top: 46,
                  width: COL * 3 - 4,
                  height: 15,
                  display: "flex",
                  padding: "0 5px",
                  borderRadius: 4,
                  background: CHIP.blue.bg,
                  color: CHIP.blue.ink,
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                제주 여행
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 휴대폰 틀. 화면은 그림 아래로 잘려 나가게 길게 둔다 */
function Phone({ now, team }: { now: Date; team: string }) {
  const PAD = 11;
  return (
    <div
      style={{
        display: "flex",
        width: SCREEN_W + PAD * 2,
        padding: PAD,
        borderRadius: 60,
        background: "#111214",
        border: "1.5px solid #3A3B40",
        boxShadow: "0 40px 80px -30px rgba(25, 31, 40, 0.45)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: SCREEN_W, height: 640, borderRadius: 50, overflow: "hidden", background: C.bg }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, padding: "0 34px 0 40px", position: "relative" }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#111111" }}>9:41</span>
          <div style={{ position: "absolute", left: (SCREEN_W - 92) / 2, top: 16, width: 92, height: 27, borderRadius: 14, background: "#000000" }} />
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
            {[5, 7, 9].map((h) => (
              <div key={h} style={{ width: 3, height: h, borderRadius: 1, background: "#111111" }} />
            ))}
            <div style={{ width: 24, height: 11, marginLeft: 5, borderRadius: 3, border: "1.5px solid #111111", padding: 1.5, display: "flex" }}>
              <div style={{ flex: 1, borderRadius: 1, background: "#111111" }} />
            </div>
          </div>
        </div>
        <CalendarScreen now={now} team={team} />
      </div>
    </div>
  );
}

/** 휴대폰에 걸친 "모두 비는 시간" 쪽지. 서비스의 핵심 장면 */
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

/** (#404) 소개 페이지 첫 화면과 같은 틀: 흰 바탕, 왼쪽 글 칸, 오른쪽 휴대폰(아래로 잘림) + 걸친 쪽지.
 *  휴대폰 속 달력은 이번 달(KST)을 그리고, 팀 이름은 초대, 일정 카드면 그 팀 이름을 넣는다 */
export function OgFrame({ children, now, team = "우리 둘" }: { children: ReactNode; now: Date; team?: string }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        background: C.tile,
        fontFamily: "Pretendard",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", right: 96, top: 58, display: "flex" }}>
        <Phone now={now} team={team} />
      </div>
      <div style={{ position: "absolute", left: 700, top: 452, display: "flex" }}>
        <FreeNote now={now} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 680,
          display: "flex",
          flexDirection: "column",
          padding: "64px 0 64px 80px",
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
