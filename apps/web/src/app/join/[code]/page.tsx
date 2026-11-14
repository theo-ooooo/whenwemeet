import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { cache } from "react";
import { Symbol } from "@/components/Logo";
import { JoinLoginActions } from "@/components/JoinLoginActions";
import { OpenInApp } from "@/components/OpenInApp";
import { Button } from "@/components/ui";
import { parseAppUserAgent } from "@/lib/app-bridge";
import { webEmailEnabled } from "@/lib/email-route";
import { planAppOpen, storeLiveFromEnv } from "@/lib/app-open";
import { invitePreviewPath, parseInviteBy } from "@/lib/invite-share";
import { CALENDAR_PATH, withTeam } from "@/lib/routes";
import { clampTeamName, INVITER_NAME_MAX } from "@/lib/og";
import { inviteOgImage, SITE_NAME } from "@/lib/site";
import { JOIN_AUTO_FRESH_SEC, JOIN_AUTO_PARAM, joinAutoNext, SESSION_COOKIE, webAppleEnabled } from "@/lib/auth";
import type { InvitePreview } from "@/lib/types";
import { serverApi } from "@/lib/server-api";
import { isFreshSession } from "@/lib/session";
import { JoinButton } from "@/screens/JoinButton";

export const dynamic = "force-dynamic";

// 초대 미리보기는 선택 인증 API (#196, D-158). 쿠키가 있으면 토큰을 같이 보내 이미 멤버인지도 받는다.
// generateMetadata 와 화면이 같은 요청을 한 번만 하게 묶는다
const loadInvite = cache((code: string, by: string | null) =>
  serverApi<InvitePreview>(invitePreviewPath(code, by), { from: `/join/${code}` }),
);

const inviterName = (data: InvitePreview) => (data.inviter ? clampTeamName(data.inviter.nickname, INVITER_NAME_MAX) : null);

// 카카오톡 공유 카드(#154): 팀 이름을 넣은 제목. 실패하면 일반 문구. og:image 는 app/og/join/[code]/route.tsx 가 팀 이름을 넣어 그린다 (#159, #204)
// (#196) 링크에 보낸 사람 표식(by)이 있으면 제목과 이미지에 그 사람 이름 (D-159)
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const code = (await params).code.toUpperCase();
  const by = parseInviteBy((await searchParams).by);
  const { data } = await loadInvite(code, by);
  const name = data && inviterName(data);
  const title = !data ? "초대받았어요" : name ? `${name}님이 ${data.groupName} 팀에 초대했어요` : `${data.groupName} 팀에 초대받았어요`;
  const shareTitle = `${title} - ${SITE_NAME}`;
  const description = "링크를 열고 합류하면 같은 달력을 함께 보고, 모두 비는 시간을 바로 찾아요";
  // 카드 이미지는 이름이 맞는 표식일 때만 by 를 넘긴다 (틀린 표식마다 이미지가 따로 생기지 않게)
  const image = inviteOgImage(code, name ? by : null);
  return {
    title,
    description,
    // (#413) 팀 이름이 검색에 남지 않게. 메신저 미리보기는 robots 와 무관하게 그대로
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ko_KR",
      title: shareTitle,
      description,
      url: `/join/${code}${by ? `?by=${by}` : ""}`,
      images: [image],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [image] },
  };
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();
  const sp = await searchParams;
  const by = parseInviteBy(sp.by);
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  const loggedIn = Boolean(session);
  // 이 초대 링크에서 막 로그인하고 돌아온 경우(next 의 `?auto=1` + 방금 발급된 세션)만 "합류하기" 없이 바로 합류한다.
  // 쿠키에 기대지 않아 카카오 인앱 브라우저에서도 동작한다. 로그인한 채 `?auto=1` 링크를 그냥 연 경우는
  // 세션이 오래돼 확인 버튼을 그대로 둔다 (실수 합류 방지, D-41)
  const autoJoin = loggedIn && sp[JOIN_AUTO_PARAM] === "1" && isFreshSession(session, JOIN_AUTO_FRESH_SEC);
  // 로그인 버튼은 /login 과 같은 판정: 앱 셸(UA)과 웹 애플 버튼 노출(APPLE_LOGIN_ENABLED=1, #129)
  // Android 앱 셸 안에서는 애플 버튼을 숨긴다 (#145)
  const ua = (await headers()).get("user-agent");
  const appUa = parseAppUserAgent(ua);
  const appGuess = appUa !== null;
  const appleEnabled = webAppleEnabled(process.env.APPLE_LOGIN_ENABLED, appUa?.os);
  // 모바일 브라우저(앱 셸 밖)면 "앱에서 열기". 카카오톡 인앱 브라우저는 열자마자 한 번 시도 (#154)
  const appOpen = planAppOpen(ua, storeLiveFromEnv(process.env.APP_STORE_LIVE));
  const { data, error } = await loadInvite(code, by);
  const inviter = data && inviterName(data);

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
      {/* 진입 화면 공통: 바탕 --bg, 로고 32, 제목 28/36, 좌우 24. 브랜드 크기 제목은 로그인만 (#174 L4) */}
      <Symbol size={32} />

      {data?.isMember && data.groupId !== null ? (
        // (#196) 이미 멤버 (1차 L9). 자동으로 보내지 않고 버튼으로, ?auto=1 자동 합류도 하지 않는다 (D-158)
        <>
          <div className="mt-auto pt-16">
            <span className="inline-flex rounded-sm border border-line px-2.5 py-1 text-[12px] font-medium text-soft">
              멤버 {data.memberCount}명
            </span>
          </div>
          <h1 className="mt-3 break-keep text-[28px] font-bold leading-9 tracking-[-0.03em]">
            {data.groupName}
            <br />
            이미 함께하는 팀이에요
          </h1>
          <p className="mt-3 text-[15px] leading-[22px] text-soft">달력에서 바로 이어서 볼 수 있어요</p>
          <Link href={data.groupCode ? withTeam(CALENDAR_PATH, data.groupCode) : CALENDAR_PATH} className="mt-8 block">
            <Button size="xl" full tabIndex={-1}>
              달력 열기
            </Button>
          </Link>
        </>
      ) : data ? (
        <>
          <div className="mt-auto pt-16">
            <span className="inline-flex rounded-sm border border-line px-2.5 py-1 text-[12px] font-medium text-soft">
              멤버 {data.memberCount}명
            </span>
          </div>
          {inviter && (
            // (#196) 보낸 사람 (D-157). 13/500 --ink-2, 한 줄 말줄임
            <p className="mt-3 truncate text-[13px] font-medium leading-5 text-ink-2">{inviter}님이 초대했어요</p>
          )}
          <h1 className={`${inviter ? "mt-1" : "mt-3"} break-keep text-[28px] font-bold leading-9 tracking-[-0.03em]`}>
            {data.groupName}
            <br />
            팀에 초대받았어요
          </h1>
          <p className="mt-3 text-[15px] leading-[22px] text-soft">합류하면 같은 달력을 함께 보고, 모두 비는 시간을 바로 찾아요</p>
          <div className="mt-8">
            {loggedIn ? (
              <JoinButton code={code} auto={autoJoin} />
            ) : (
              <JoinLoginActions
                next={joinAutoNext(code, by)}
                appleEnabled={appleEnabled}
                appGuess={appGuess}
                emailEnabled={webEmailEnabled()}
              />
            )}
            <OpenInApp plan={appOpen} />
          </div>
        </>
      ) : error?.code === "INVITE_NOT_FOUND" ? (
        <>
          <h1 className="mt-auto text-[28px] font-bold leading-9 tracking-[-0.03em]">
            초대 링크가 만료됐거나 잘못됐어요
          </h1>
          <p className="mt-2 text-[15px] leading-[22px] text-soft">초대한 사람에게 새 링크를 받아 주세요</p>
          <Link href="/" className="mt-8 block">
            <Button size="lg" full tabIndex={-1}>
              홈으로
            </Button>
          </Link>
        </>
      ) : (
        <>
          <h1 className="mt-auto text-[28px] font-bold leading-9 tracking-[-0.03em]">
            초대 정보를 불러오지 못했어요
          </h1>
          <p className="mb-10 mt-2 text-[15px] leading-[22px] text-soft">{error?.message || "새로고침해 주세요"}</p>
        </>
      )}
    </main>
  );
}
