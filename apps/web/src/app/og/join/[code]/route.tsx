// 초대 링크 공유 미리보기 이미지 (#159). 팀 이름(최대 2줄), 멤버 수, 버튼 모양 칩. 코드가 없거나 API 가 안 되면 일반 초대 카드
// 공개 API 응답은 5분 캐시(INVITE_OG_REVALIDATE). 이미지 응답도 CDN 에 5분, 실패한 일반 카드는 1분만 둔다
// (#204) join/[code]/opengraph-image.tsx 에서 옮김. 주소는 join/[code]/page.tsx generateMetadata 가 inviteOgImage(code) 로 단다
import { ImageResponse } from "next/og";
import { clampTeamName, teamNameFontSize, teamNameWordBreak } from "@/lib/og";
import { OG_SIZE, OgCopy, OgFrame } from "../../../_og/card";
import { ogFonts } from "../../../_og/fonts";
import { INVITE_OG_REVALIDATE, loadInviteForOg } from "../../../_og/invite";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const [invite, fonts] = await Promise.all([loadInviteForOg(code), ogFonts()]);
  const maxAge = invite ? INVITE_OG_REVALIDATE : 60;
  const headers = { "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400` };
  const now = new Date();

  if (!invite) {
    return new ImageResponse(
      (
        <OgFrame now={now}>
          <OgCopy
            lines={[{ text: "같은 달력에" }, { text: "초대받았어요", gap: 6 }]}
            titleSize={80}
            lead="합류하면 모두 비는 시간을 바로 찾아요"
            chip="초대 수락하기"
          />
        </OgFrame>
      ),
      { ...OG_SIZE, fonts, headers },
    );
  }

  const name = clampTeamName(invite.groupName);
  const nameSize = teamNameFontSize(name);
  return new ImageResponse(
    (
      <OgFrame now={now}>
        <OgCopy
          kicker={`멤버 ${invite.memberCount}명`}
          lines={[{ text: name, clamp: 2, wordBreak: teamNameWordBreak(name, nameSize) }, { text: "팀에 초대받았어요", size: 48, gap: 14 }]}
          titleSize={nameSize}
          lead="합류하면 같은 달력을 함께 봐요"
          chip="초대 수락하기"
        />
      </OgFrame>
    ),
    { ...OG_SIZE, fonts, headers },
  );
}
