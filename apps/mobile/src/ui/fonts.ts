// Pretendard (웹과 같은 글꼴, docs/설계/디자인토큰.md). SIL OFL 1.1 — assets/fonts/Pretendard-LICENSE.txt 를 함께 둔다.
// 원본 OTF 를 고치지 않고(예약 글꼴 이름 조항) 셸 화면에 쓰는 굵기 셋만 넣는다: 400 본문, 500 칩, 700 제목/버튼 (#145).
// 굵기마다 다른 family 이름으로 등록하고 fontWeight 는 쓰지 않는다 (Android 는 사용자 글꼴에 fontWeight 를 주면 합성 굵기가 된다)
import { useFonts } from "expo-font";

export const FONT_FILES = {
  "Pretendard-Regular": require("../../assets/fonts/Pretendard-Regular.otf"),
  "Pretendard-Medium": require("../../assets/fonts/Pretendard-Medium.otf"),
  "Pretendard-Bold": require("../../assets/fonts/Pretendard-Bold.otf"),
} as const;

export type FontWeight = 400 | 500 | 700;

/** 글꼴을 읽었으면 Pretendard family, 아직이면(또는 실패) 시스템 글꼴 + 같은 굵기 */
export function fontStyle(weight: FontWeight, loaded: boolean) {
  if (!loaded) return { fontWeight: String(weight) as "400" | "500" | "700" };
  return { fontFamily: weight === 700 ? "Pretendard-Bold" : weight === 500 ? "Pretendard-Medium" : "Pretendard-Regular" };
}

/** 앱 시작 때 한 번 부르면 이후 호출은 캐시. 실패해도 시스템 글꼴로 그린다 */
export function usePretendard(): boolean {
  const [loaded, error] = useFonts(FONT_FILES);
  return loaded && !error;
}
