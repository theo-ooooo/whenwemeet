// 셸 네이티브 화면 색 (docs/설계/디자인토큰.md 의 배경색과 같은 값)
import { useColorScheme } from "react-native";

export function useTheme() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    bg: dark ? "#121214" : "#F4F3F1",
    text: dark ? "#F4F3F1" : "#121214",
    sub: dark ? "#9C9CA3" : "#6B6B73",
    brand: "#9A1DFF",
    error: "#E5484D",
  };
}
