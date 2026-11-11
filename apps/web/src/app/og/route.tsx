// 사이트 기본 공유 미리보기 이미지 (#159). 모든 화면의 og:image (layout.tsx metadata 의 SITE_OG_IMAGE 가 이 주소)
// 그림 속 달력이 이번 달이라 하루에 한 번 새로 그린다
// (#204) 메타데이터 파일 규칙(app/opengraph-image.tsx)은 하위 모든 페이지 함수에 글꼴과 @vercel/og 를 끌어들여 route handler 로 옮겼다
import { ImageResponse } from "next/og";
import { OG_SIZE, OgCopy, OgFrame } from "../_og/card";
import { ogFonts } from "../_og/fonts";

export const revalidate = 86400;

export async function GET() {
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
