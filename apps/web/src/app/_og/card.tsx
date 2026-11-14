// 공유 미리보기 카드 그림 (#159). next/og(satori) 용 JSX 라 Tailwind 대신 인라인 style, 자식이 둘 이상이면 display:flex
// 색은 디자인 토큰 D-57 (라이트): 바탕 --tile(흰색), 휴대폰 화면 --bg, 글자 --ink/--mute, 강조 --sel-fill
import type { ReactNode } from "react";
import { TEAM_NAME_WIDTH } from "@/lib/og";

export const OG_SIZE = { width: 1200, height: 630 };

const C = {
  bg: "#F4F3F1",
  tile: "#FFFFFF",
  ink: "#26252A",
  mute: "#6C6C70",
  line: "#ECEBE8",
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

/** 휴대폰 틀 안에 실제 팀 달력 화면 사진(#404). 화면은 그림 아래로 잘려 나가게 길게 둔다 */
function Phone({ shot }: { shot: string }) {
  const W = 330;
  const PAD = 11;
  const SCREEN_W = W - PAD * 2;
  return (
    <div
      style={{
        display: "flex",
        width: W,
        padding: PAD,
        borderRadius: 60,
        background: "#111214",
        border: "1.5px solid #3A3B40",
        boxShadow: "0 40px 80px -30px rgba(25, 31, 40, 0.45)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: SCREEN_W, height: 640, borderRadius: 50, overflow: "hidden", background: C.bg }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 80, padding: "0 34px 0 40px", position: "relative" }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#111111" }}>9:41</span>
          <div style={{ position: "absolute", left: (SCREEN_W - 92) / 2, top: 18, width: 92, height: 27, borderRadius: 14, background: "#000000" }} />
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
            {[5, 7, 9].map((h) => (
              <div key={h} style={{ width: 3, height: h, borderRadius: 1, background: "#111111" }} />
            ))}
            <div style={{ width: 24, height: 11, marginLeft: 5, borderRadius: 3, border: "1.5px solid #111111", padding: 1.5, display: "flex" }}>
              <div style={{ flex: 1, borderRadius: 1, background: "#111111" }} />
            </div>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- satori 그림 */}
        <img src={shot} width={SCREEN_W} height={Math.round((SCREEN_W * 1240) / 780)} alt="" style={{ objectFit: "cover", objectPosition: "top" }} />
      </div>
    </div>
  );
}

/** (#404) 소개 페이지 첫 화면과 같은 틀: 흰 바탕, 왼쪽 글 칸, 오른쪽 휴대폰. 휴대폰은 아래로 잘려 나가게 둔다 */
export function OgFrame({ children, shot }: { children: ReactNode; shot: string }) {
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
        <Phone shot={shot} />
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
