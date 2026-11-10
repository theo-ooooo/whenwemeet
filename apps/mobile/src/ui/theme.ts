// 셸 네이티브 화면 색 (docs/설계/디자인토큰.md 의 배경색과 같은 값)
import { useColorScheme } from "react-native";

// 로그인 화면 색: apps/web/src/app/globals.css 의 :root(라이트), 다크 변수와 같은 값 (#145)
const LOGIN_LIGHT = {
  loginBg: "#FFFFFF",
  ink: "#26252A",
  soft: "#555555",
  mute: "#6C6C70",
  line: "#ECEBE8",
  surface: "#F4F3F1",
  accInk: "#C2402A",
  danger: "#D1242F",
};
const LOGIN_DARK: typeof LOGIN_LIGHT = {
  loginBg: "#121214",
  ink: "#ECECEF",
  soft: "#A1A1A6",
  mute: "#8E8E93",
  line: "#2A2A2F",
  surface: "#121214",
  accInk: "#FF8670",
  danger: "#FF6B6B",
};

export function useTheme() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    bg: dark ? "#121214" : "#F4F3F1",
    text: dark ? "#F4F3F1" : "#121214",
    sub: dark ? "#9C9CA3" : "#6B6B73",
    brand: "#9A1DFF",
    error: "#E5484D",
    login: dark ? LOGIN_DARK : LOGIN_LIGHT,
  };
}
