// 사이트 기본 공유 미리보기 이미지 (#159). 모든 화면의 og:image (하위 경로에 opengraph-image 가 없으면 이것을 물려받는다)
// 그림 속 달력이 이번 달이라 하루에 한 번 새로 그린다
import { ImageResponse } from "next/og";
import { SITE_TITLE } from "@/lib/site";
import { OG_SIZE, OgCopy, OgFrame } from "./_og/card";
import { ogFonts } from "./_og/fonts";

export const alt = SITE_TITLE;
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 86400;

export default async function Image() {
  return new ImageResponse(
    (
      <OgFrame now={new Date()}>
        <OgCopy
          lines={[{ text: "우리 언제 볼까?" }, { text: "달력 하나로 정해요", gap: 6 }]}
          titleSize={76}
          lead="같이 쓰는 달력이 모두 비는 시간을 찾아줘요"
          chip="달력 같이 쓰기"
        />
      </OgFrame>
    ),
    { ...OG_SIZE, fonts: await ogFonts() },
  );
}
