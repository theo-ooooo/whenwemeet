// 초대 링크 공유 미리보기 이미지 (#159). 팀 이름(최대 2줄), 멤버 수, 버튼 모양 칩. 코드가 없거나 API 가 안 되면 일반 초대 카드
// 공개 API 응답은 5분 캐시(INVITE_OG_REVALIDATE). 이미지 응답도 CDN 에 5분, 실패한 일반 카드는 1분만 둔다
// (#204) join/[code]/opengraph-image.tsx 에서 옮김. 주소는 join/[code]/page.tsx generateMetadata 가 inviteOgImage(code) 로 단다
import { ImageResponse } from "next/og";
import { parseInviteBy } from "@/lib/invite-share";
import { clampTeamName, INVITER_NAME_MAX, teamNameFontSize, teamNameWordBreak } from "@/lib/og";
import { OG_SIZE, OgCopy, OgFrame } from "../../../_og/card";
import { ogFonts } from "../../../_og/fonts";
import { INVITE_OG_REVALIDATE, loadInviteForOg } from "../../../_og/invite";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  // (#196) 보낸 사람 표식. 주소는 join/[code]/page.tsx 가 inviteOgImage(code, by) 로 단다
  const by = parseInviteBy(new URL(req.url).searchParams.get("by"));
  const [invite, fonts] = await Promise.all([loadInviteForOg(code, by), ogFonts()]);
  const maxAge = invite ? INVITE_OG_REVALIDATE : 60;
  const now = new Date();
  const headers = { "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400` };

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
      <OgFrame now={now} team={clampTeamName(invite.groupName, 10)}>
        <OgCopy
          kicker={invite.inviter ? `${clampTeamName(invite.inviter.nickname, INVITER_NAME_MAX)}님이 초대했어요` : `멤버 ${invite.memberCount}명`}
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
