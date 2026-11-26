import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cache } from "react";
import { Symbol } from "@/components/Logo";
import { JoinLoginActions } from "@/components/JoinLoginActions";
import { OpenInApp } from "@/components/OpenInApp";
import { Button } from "@/components/ui";
import { parseAppUserAgent } from "@/lib/app-bridge";
import { NO_APP_PARAM, NO_APP_VALUE, planAppOpen, storeLiveFromEnv } from "@/lib/app-open";
import { JOIN_AUTO_FRESH_SEC, JOIN_AUTO_PARAM, SESSION_COOKIE, webAppleEnabled } from "@/lib/auth";
import { memberColor } from "@/lib/colors";
import { webEmailEnabled } from "@/lib/email-route";
import {
  eventShareAutoNext,
  eventShareLandingHref,
  eventShareMetaTitle,
  eventSharePath,
  eventSharePreviewPath,
  eventShareRepeatLabel,
  eventShareTimeLabel,
  parseEventShareToken,
} from "@/lib/event-share";
import { clampTeamName, INVITER_NAME_MAX } from "@/lib/og";
import { serverApi } from "@/lib/server-api";
import { isFreshSession } from "@/lib/session";
import { eventShareOgImage, SITE_NAME } from "@/lib/site";
import type { EventSharePreview } from "@/lib/types";
import { EventShareJoinButton } from "@/screens/EventShareJoinButton";

export const dynamic = "force-dynamic";

// (#274) 일정 카드 공유 받는 화면 (D-186). 미리보기는 선택 인증 API: 쿠키가 있으면 토큰을 같이 보내 이미 멤버인지 받는다.
// 토큰 모양이 아니면 API 를 부르지 않고 만료 화면. generateMetadata 와 화면이 같은 요청을 한 번만 하게 묶는다
const loadShare = cache(async (raw: string) => {
  const token = parseEventShareToken(raw);
  if (!token) return { token: null, data: null, error: { code: "EVENT_SHARE_NOT_FOUND", message: "" } };
  const { data, error } = await serverApi<EventSharePreview>(eventSharePreviewPath(token), { from: eventSharePath(token) });
  return { token, data, error };
});

// 공유 카드: 제목 "{일정 제목} - {팀 이름}", 설명은 날짜와 시각 줄. 실패하면 일반 문구. og:image 는 app/og/join/e/[token]/route.tsx
// 토큰이 다른 사이트로 새지 않게 referrer 를 보내지 않는다 (next.config 헤더와 같은 뜻)
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const raw = (await params).token;
  const { token, data } = await loadShare(raw);
  const title = data ? eventShareMetaTitle(data) : "일정을 공유받았어요";
  const description = data ? eventShareTimeLabel(data.event) : "링크를 열면 일정을 함께 볼 수 있어요";
  const shareTitle = `${title} - ${SITE_NAME}`;
  const image = eventShareOgImage(token ?? raw);
  return {
    title,
    description,
    referrer: "no-referrer",
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ko_KR",
      title: shareTitle,
      description,
      url: eventSharePath(token ?? raw),
      images: [image],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [image] },
  };
}

const chip = "inline-flex rounded-sm border border-line px-2.5 py-1 text-[12px] font-medium text-soft";

export default async function EventSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token: raw } = await params;
  const sp = await searchParams;
  const { token, data, error } = await loadShare(raw);
  const ua = (await headers()).get("user-agent");
  // 모바일 브라우저(앱 셸 밖)면 "앱에서 열기". 경로 /join/e/<token> 은 기존 앱 링크(/join)가 덮는다
  const appOpen = planAppOpen(ua, storeLiveFromEnv(process.env.APP_STORE_LIVE));
  // 이미 멤버면 화면 없이 그 일정이 열린 달력으로 (D-184). 페이지를 여는 것만으로 합류하지 않는다 (D-41)
  // (2026-11-13) 모바일 브라우저면 먼저 앱으로 열지 묻는다. 웹을 고르거나 앱이 없으면(app=0) 그때 달력으로
  if (data?.viewer.member) {
    const landing = eventShareLandingHref(data.viewer);
    if (!appOpen.show || sp[NO_APP_PARAM] === NO_APP_VALUE) redirect(landing);
    return (
      <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(34px+var(--sab))] pt-[max(60px,var(--sat))]">
        <Symbol size={32} />
        <h1 className="mt-auto break-keep text-[28px] font-bold leading-9 tracking-[-0.03em]">이미 함께하는 팀이에요</h1>
        <p className="mt-2 text-[15px] leading-[22px] text-soft">일정이 열린 달력으로 이동해요</p>
        <Link href={landing} className="mt-8 block">
          <Button size="lg" full tabIndex={-1}>
            달력 보기
          </Button>
        </Link>
        <OpenInApp plan={appOpen} webHref={landing} />
      </main>
    );
  }

  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const loggedIn = Boolean(session);
  // 이 링크에서 막 로그인하고 돌아온 경우(`?auto=1` + 방금 발급된 세션)만 확인 없이 합류 (초대와 같은 D-41)
  const autoJoin = loggedIn && sp[JOIN_AUTO_PARAM] === "1" && isFreshSession(session, JOIN_AUTO_FRESH_SEC);
  const appUa = parseAppUserAgent(ua);
  const appleEnabled = webAppleEnabled(process.env.APPLE_LOGIN_ENABLED, appUa?.os);
  const sharer = data?.sharer ? clampTeamName(data.sharer.displayName, INVITER_NAME_MAX) : null;
  const repeat = data ? eventShareRepeatLabel(data.event.repeat) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(34px+var(--sab))] pt-[max(60px,var(--sat))]">
      {/* 초대 화면과 같은 짜임: 바탕 --bg, 로고 32, 제목 28/36, 좌우 24 */}
      <Symbol size={32} />

      {data && token ? (
        <>
          <div className="mt-auto pt-16">
            <span className={chip}>{sharer ? `${sharer}님이 보낸 일정` : "공유받은 일정"}</span>
          </div>
          <h1 className="mt-3 line-clamp-2 break-keep text-[28px] font-bold leading-9 tracking-[-0.03em] [overflow-wrap:anywhere]">
            {data.event.title}
          </h1>
          {/* (#343) 일정 색을 골랐으면 시각 줄 앞에 그 색 점 (D-215). 자동이면 점 없음 (참여자는 미리보기에 없다) */}
          <p className="mt-3 flex items-center gap-2 text-[15px] font-semibold leading-[22px]">
            {data.event.color && <i aria-hidden="true" className="block size-2.5 shrink-0 rounded-full" style={{ background: memberColor(data.event.color) }} />}
            {eventShareTimeLabel(data.event)}
          </p>
          {repeat && <p className="mt-0.5 text-[13px] leading-5 text-soft">{repeat}</p>}
          <p className="mt-2 truncate text-[13px] font-medium leading-5 text-ink-2">
            {clampTeamName(data.groupName)} 팀, 멤버 {data.memberCount}명
          </p>
          <p className="mt-4 text-[15px] leading-[22px] text-soft">합류하면 이 팀의 모든 일정을 함께 봐요</p>
          <div className="mt-8">
            {loggedIn ? (
              <EventShareJoinButton token={token} auto={autoJoin} />
            ) : (
              <JoinLoginActions
                next={eventShareAutoNext(token)}
                appleEnabled={appleEnabled}
                appGuess={appUa !== null}
                emailEnabled={webEmailEnabled()}
              />
            )}
            <OpenInApp plan={appOpen} />
          </div>
        </>
      ) : error?.code === "EVENT_SHARE_NOT_FOUND" ? (
        <>
          <h1 className="mt-auto text-[28px] font-bold leading-9 tracking-[-0.03em]">링크가 만료됐거나 끊겼어요</h1>
          <p className="mt-2 text-[15px] leading-[22px] text-soft">보낸 사람에게 새 링크를 받아 주세요</p>
          <Link href="/" className="mt-8 block">
            <Button size="lg" full tabIndex={-1}>
              홈으로
            </Button>
          </Link>
        </>
      ) : (
        <>
          <h1 className="mt-auto text-[28px] font-bold leading-9 tracking-[-0.03em]">일정을 불러오지 못했어요</h1>
          <p className="mb-10 mt-2 text-[15px] leading-[22px] text-soft">{error?.message || "새로고침해 주세요"}</p>
        </>
      )}
    </main>
  );
}
