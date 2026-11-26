// (#274) 일정 카드 공유 미리보기 이미지. kicker 날짜와 시각, 큰 줄 일정 제목(최대 2줄), 작은 줄 "{팀} 팀 일정", 칩 "일정 보기".
// 메모, 참여자는 그리지 않는다 (API 가 주지도 않는다). 링크가 끝났거나 API 가 안 되면 일반 일정 카드.
// 캐시는 초대 카드와 같이 성공 5분, 실패 1분. 주소는 join/e/[token]/page.tsx generateMetadata 가 eventShareOgImage(token) 로 단다
import { ImageResponse } from "next/og";
import { eventShareRepeatLabel, eventShareTimeLabel } from "@/lib/event-share";
import { clampTeamName, teamNameFontSize, teamNameWordBreak } from "@/lib/og";
import { OG_SIZE, OgCopy, OgFrame } from "../../../../_og/card";
import { loadEventShareForOg } from "../../../../_og/event-share";
import { ogFonts } from "../../../../_og/fonts";
import { INVITE_OG_REVALIDATE } from "../../../../_og/invite";

/** 일정 제목은 팀 이름보다 길 수 있어(50자) 2줄 안 글자 수를 조금 더 준다 */
const EVENT_TITLE_MAX = 30;

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [share, fonts] = await Promise.all([loadEventShareForOg(token), ogFonts()]);
  const maxAge = share ? INVITE_OG_REVALIDATE : 60;
  const now = new Date();
  const headers = { "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400` };

  if (!share) {
    return new ImageResponse(
      <OgFrame now={now}>
        <OgCopy lines={[{ text: "일정을" }, { text: "공유받았어요", gap: 6 }]} titleSize={80} lead="링크를 열면 일정을 함께 볼 수 있어요" chip="일정 보기" />
      </OgFrame>,
      { ...OG_SIZE, fonts, headers },
    );
  }

  const title = clampTeamName(share.event.title, EVENT_TITLE_MAX);
  const titleSize = teamNameFontSize(title);
  const repeat = eventShareRepeatLabel(share.event.repeat);
  return new ImageResponse(
    <OgFrame now={now} team={clampTeamName(share.groupName, 10)}>
      <OgCopy
        kicker={eventShareTimeLabel(share.event)}
        lines={[
          { text: title, clamp: 2, wordBreak: teamNameWordBreak(title, titleSize) },
          { text: `${clampTeamName(share.groupName)} 팀 일정`, size: 44, gap: 14, clamp: 1 },
        ]}
        titleSize={titleSize}
        lead={repeat ? `${repeat}, 합류하면 함께 봐요` : "합류하면 같은 달력을 함께 봐요"}
        chip="일정 보기"
      />
    </OgFrame>,
    { ...OG_SIZE, fonts, headers },
  );
}
