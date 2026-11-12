// (#197) Android 홈 화면 위젯 "오늘" (작은 2x2, 중간 4x2). react-native-android-widget (앱.md 4.7, D-188).
// expo-widgets 의 Android(enableAndroid)는 누름 → 딥링크, 갱신 주기, 크기 정보가 없어 이 라이브러리로 대신한다.
// 값 계산은 snapshot.ts widgetProps 가 하고 여기는 그리기만 한다. 라이트/다크 두 벌을 넘기면 런처가 고른다.
import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { WidgetProps } from "./snapshot";

/** app.config.ts react-native-android-widget widgets[].name 과 같은 값 */
export const ANDROID_WIDGET_NAMES = { small: "WwmTodaySmall", medium: "WwmTodayMedium" } as const;

type Palette = { bg: `#${string}`; ink: `#${string}`; mute: `#${string}`; today: `#${string}`; pri: `#${string}`; members: `#${string}`[] };

// 디자인토큰.md (--tile, --ink, --mute, --today-ink, --pri, --m1 ~ --m8, #350 D-216)
const LIGHT: Palette = {
  bg: "#FFFFFF",
  ink: "#26252A",
  mute: "#6C6C70",
  today: "#C2412C",
  pri: "#E0533D",
  members: ["#3B82F6", "#EAB308", "#14B8A6", "#8B5CF6", "#22C55E", "#FB923C", "#0EA5E9", "#EC4899"],
};
const DARK: Palette = {
  bg: "#1D1D21",
  ink: "#ECECEF",
  mute: "#8E8E93",
  today: "#FFB4A5",
  pri: "#FF8670",
  members: ["#60A5FA", "#FACC15", "#2DD4BF", "#A78BFA", "#4ADE80", "#FDBA74", "#38BDF8", "#F472B6"],
};

/** 너비(dp)가 이보다 좁으면 작은 모양 (중간 위젯을 줄였을 때도) */
const MEDIUM_MIN_WIDTH_DP = 220;

function notice(p: WidgetProps): string | null {
  if (p.kind === "signedOut") return "언제볼까를 열어 로그인해 주세요";
  if (!p.known) return "앱을 열면 새로 고쳐져요";
  if (p.rows.length === 0) return "오늘은 일정이 없어요";
  return null;
}

function Dot({ color }: { color: `#${string}` }) {
  return <FlexWidget style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, marginRight: 6 }} />;
}

function Body({ p, c, medium }: { p: WidgetProps; c: Palette; medium: boolean }) {
  const n = notice(p);
  const header = (
    <FlexWidget style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
      <TextWidget text={p.kind === "signedOut" ? "언제볼까" : "오늘"} style={{ fontSize: 13, fontWeight: "700", color: c.today, marginRight: 6 }} />
      <TextWidget text={p.dateText} maxLines={1} truncate="END" style={{ fontSize: 12, fontWeight: "500", color: c.mute }} />
    </FlexWidget>
  );
  const noticeView = n ? (
    <TextWidget
      text={n}
      maxLines={3}
      truncate="END"
      style={{ fontSize: 14, fontWeight: "600", color: p.kind === "signedOut" ? c.ink : c.mute }}
    />
  ) : null;
  const staleView =
    p.kind === "today" && p.stale && p.known ? (
      <TextWidget text="앱을 열면 새로 고쳐져요" maxLines={1} style={{ fontSize: 10, color: c.mute, marginTop: 2 }} />
    ) : null;
  const ann = p.anniversary;

  if (!medium) {
    const first = p.rows[0];
    const rest = p.rows.length - 1 + p.more;
    return (
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: p.url }}
        style={{ height: "match_parent", width: "match_parent", backgroundColor: c.bg, borderRadius: 22, padding: 14, flexDirection: "column" }}
      >
        {header}
        <FlexWidget style={{ flex: 1, flexDirection: "column", justifyContent: "center", width: "match_parent" }}>
          {noticeView}
          {first ? (
            <FlexWidget style={{ flexDirection: "column" }}>
              <FlexWidget style={{ flexDirection: "row", alignItems: "center" }}>
                <Dot color={c.members[first.color] ?? c.mute} />
                <TextWidget text={first.time} maxLines={1} style={{ fontSize: 12, fontWeight: "500", color: c.mute }} />
              </FlexWidget>
              <TextWidget text={first.title} maxLines={2} truncate="END" style={{ fontSize: 15, fontWeight: "700", color: c.ink }} />
              {rest > 0 ? <TextWidget text={`+${rest}개`} style={{ fontSize: 11, fontWeight: "500", color: c.mute }} /> : null}
            </FlexWidget>
          ) : null}
        </FlexWidget>
        {ann ? (
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: ann.url }}
            style={{ flexDirection: "row", alignItems: "center", width: "match_parent" }}
          >
            <TextWidget text={ann.title} maxLines={1} truncate="END" style={{ fontSize: 12, fontWeight: "500", color: c.ink }} />
            <FlexWidget style={{ flex: 1 }} />
            <TextWidget text={ann.dday} style={{ fontSize: 13, fontWeight: "800", color: c.pri, marginLeft: 4 }} />
          </FlexWidget>
        ) : null}
        {staleView}
      </FlexWidget>
    );
  }

  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: p.url }}
      style={{ height: "match_parent", width: "match_parent", backgroundColor: c.bg, borderRadius: 22, padding: 14, flexDirection: "row" }}
    >
      <FlexWidget style={{ flex: 1, flexDirection: "column", height: "match_parent" }}>
        {header}
        {noticeView}
        {p.rows.map((r, i) => (
          <FlexWidget key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4, width: "match_parent" }}>
            <Dot color={c.members[r.color] ?? c.mute} />
            <TextWidget text={r.time} maxLines={1} style={{ fontSize: 12, fontWeight: "500", color: c.mute, width: 48 }} />
            <TextWidget text={r.title} maxLines={1} truncate="END" style={{ fontSize: 14, fontWeight: "600", color: c.ink }} />
            {r.team ? (
              <TextWidget text={r.team} maxLines={1} truncate="END" style={{ fontSize: 10, color: c.mute, marginLeft: 4 }} />
            ) : null}
          </FlexWidget>
        ))}
        {p.more > 0 ? <TextWidget text={`+${p.more}개`} style={{ fontSize: 11, fontWeight: "500", color: c.mute }} /> : null}
        <FlexWidget style={{ flex: 1 }} />
        {staleView}
      </FlexWidget>
      {ann ? (
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: ann.url }}
          style={{ width: 96, marginLeft: 12, flexDirection: "column", alignItems: "flex-end" }}
        >
          <TextWidget text="기념일" style={{ fontSize: 11, fontWeight: "500", color: c.mute }} />
          <TextWidget text={ann.dday} maxLines={1} style={{ fontSize: 24, fontWeight: "800", color: c.pri }} />
          <TextWidget text={ann.title} maxLines={2} truncate="END" style={{ fontSize: 12, fontWeight: "500", color: c.ink, textAlign: "right" }} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

/** 위젯 하나 그리기. 라이트/다크 두 벌 (런처가 시스템 테마로 고른다) */
export function renderTodayWidget(p: WidgetProps, widgetName: string, widthDp: number) {
  const medium = widgetName === ANDROID_WIDGET_NAMES.medium && (widthDp <= 0 || widthDp >= MEDIUM_MIN_WIDTH_DP);
  return {
    light: <Body p={p} c={LIGHT} medium={medium} />,
    dark: <Body p={p} c={DARK} medium={medium} />,
  };
}
