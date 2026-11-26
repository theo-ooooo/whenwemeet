// (#197) iOS 홈 화면 위젯 "오늘" (작은, 중간). expo-widgets + @expo/ui/swift-ui (앱.md 4.7)
// 'widget' 함수는 위젯 익스텐션의 격리된 런타임에서 돈다: 훅, 상태, 비동기 금지, 함수 밖에 선언한 값(상수, 도우미)을 못 쓴다.
// 그래서 색과 문구를 함수 안에 둔다. 값 계산은 셸이 미리 해서 props(WidgetProps)로 넣는다 (snapshot.ts widgetProps).
// 잠금 상태 가림: 시스템 설정 "잠금 상태에서 위젯 내용 가리기" 를 따른다. 일정 제목이 민감할 수 있어 unredacted 를 쓰지 않는다
import { Ellipse, HStack, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, frame, lineLimit, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import { SIGNED_OUT_PROPS, toNativeProps, type WidgetProps } from "./snapshot";

/** app.config.ts 의 expo-widgets widgets[].name 과 같은 값 */
export const IOS_WIDGET_NAME = "WwmToday";

const TodayWidget = (p: WidgetProps, env: WidgetEnvironment) => {
  "widget";
  // 디자인토큰.md 라이트/다크 (--tile, --ink, --mute, --today-ink, --pri, --m1 ~ --m8, #350 D-216)
  const dark = env.colorScheme === "dark";
  const c = dark
    ? { bg: "#1D1D21", ink: "#ECECEF", mute: "#8E8E93", today: "#FFB4A5", pri: "#FF8670" }
    : { bg: "#FFFFFF", ink: "#26252A", mute: "#6C6C70", today: "#C2412C", pri: "#E0533D" };
  const members = dark
    ? ["#60A5FA", "#FACC15", "#2DD4BF", "#A78BFA", "#4ADE80", "#FDBA74", "#38BDF8", "#F472B6"]
    : ["#3B82F6", "#EAB308", "#14B8A6", "#8B5CF6", "#22C55E", "#FB923C", "#0EA5E9", "#EC4899"];
  const medium = env.widgetFamily === "systemMedium";

  const header = (
    <HStack spacing={6}>
      <Text modifiers={[font({ size: 13, weight: "bold" }), foregroundStyle(c.today)]}>{p.kind === "signedOut" ? "언제볼까" : "오늘"}</Text>
      <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(c.mute), lineLimit(1)]}>{p.dateText}</Text>
    </HStack>
  );

  // 일정 칸에 들어갈 안내 한 줄 (없으면 null)
  const notice =
    p.kind === "signedOut" ? "언제볼까를 열어 로그인해 주세요" : !p.known ? "앱을 열면 새로 고쳐져요" : p.rows.length === 0 ? "오늘은 일정이 없어요" : null;
  const noticeView = notice ? (
    <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(p.kind === "signedOut" ? c.ink : c.mute), lineLimit(3)]}>{notice}</Text>
  ) : null;
  // 24시간 넘게 앱을 안 열었으면 날짜는 넘어가되 아래 작게 알린다 (범위를 벗어나 위 안내가 이미 같은 말이면 생략)
  const staleView =
    p.kind === "today" && p.stale && p.known ? (
      <Text modifiers={[font({ size: 10 }), foregroundStyle(c.mute), lineLimit(1)]}>앱을 열면 새로 고쳐져요</Text>
    ) : null;
  const moreView = p.more > 0 ? <Text modifiers={[font({ size: 11, weight: "medium" }), foregroundStyle(c.mute)]}>{`+${p.more}개`}</Text> : null;

  if (!medium) {
    // 작은: 오늘 첫 일정 하나 + 가장 가까운 기념일
    const first = p.rows[0];
    return (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[containerBackground(c.bg, "widget"), widgetURL(p.url), frame({ maxWidth: 10000, maxHeight: 10000, alignment: "topLeading" })]}
      >
        {header}
        <Spacer />
        {noticeView}
        {first ? (
          <VStack alignment="leading" spacing={2}>
            <HStack spacing={4}>
              <Ellipse modifiers={[frame({ width: 6, height: 6 }), foregroundStyle(members[first.color] ?? c.mute)]} />
              <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(c.mute), lineLimit(1)]}>{first.time}</Text>
            </HStack>
            <Text modifiers={[font({ size: 15, weight: "bold" }), foregroundStyle(c.ink), lineLimit(2)]}>{first.title}</Text>
            {p.rows.length + p.more > 1 ? (
              <Text modifiers={[font({ size: 11, weight: "medium" }), foregroundStyle(c.mute)]}>{`+${p.rows.length - 1 + p.more}개`}</Text>
            ) : null}
          </VStack>
        ) : null}
        <Spacer />
        {p.anniversary ? (
          <HStack spacing={4}>
            <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(c.ink), lineLimit(1)]}>{p.anniversary.title}</Text>
            <Spacer />
            <Text modifiers={[font({ size: 13, weight: "heavy" }), foregroundStyle(c.pri)]}>{p.anniversary.dday}</Text>
          </HStack>
        ) : null}
        {staleView}
      </VStack>
    );
  }

  // 중간: 왼쪽 오늘 일정 최대 3개 + "+N개", 오른쪽 기념일 D-day (누르면 기념일 화면)
  return (
    <HStack spacing={12} alignment="top" modifiers={[containerBackground(c.bg, "widget"), widgetURL(p.url)]}>
      <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: 10000, maxHeight: 10000, alignment: "topLeading" })]}>
        {header}
        {noticeView}
        {p.rows.map((r, i) => (
          <HStack key={i} spacing={6}>
            <Ellipse modifiers={[frame({ width: 7, height: 7 }), foregroundStyle(members[r.color] ?? c.mute)]} />
            <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(c.mute), lineLimit(1), frame({ width: 44, alignment: "leading" })]}>
              {r.time}
            </Text>
            <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(c.ink), lineLimit(1)]}>{r.title}</Text>
            {r.team ? <Text modifiers={[font({ size: 10 }), foregroundStyle(c.mute), lineLimit(1)]}>{r.team}</Text> : null}
          </HStack>
        ))}
        {moreView}
        <Spacer />
        {staleView}
      </VStack>
      {p.anniversary ? (
        <Link destination={p.anniversary.url}>
          <VStack alignment="trailing" spacing={2} modifiers={[frame({ width: 96, alignment: "topTrailing" })]}>
            <Text modifiers={[font({ size: 11, weight: "medium" }), foregroundStyle(c.mute)]}>기념일</Text>
            <Text modifiers={[font({ size: 24, weight: "heavy" }), foregroundStyle(c.pri), lineLimit(1)]}>{p.anniversary.dday}</Text>
            <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(c.ink), lineLimit(2)]}>{p.anniversary.title}</Text>
          </VStack>
        </Link>
      ) : null}
    </HStack>
  );
};

/** 앱 첫 실행 전(위젯 갤러리)과 스냅샷이 없을 때는 로그인 안내 */
/** (#462) null 이 든 props 를 그대로 넘기면 네이티브 생성자가 예외를 내 앱이 시작하자마자 꺼진다 */
export const todayWidget = createWidget<WidgetProps>(IOS_WIDGET_NAME, TodayWidget, toNativeProps(SIGNED_OUT_PROPS));
