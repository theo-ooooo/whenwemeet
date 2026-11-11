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
import { SITE_NAME } from "@/lib/site";
import { JOIN_AUTO_FRESH_SEC, JOIN_AUTO_PARAM, joinAutoNext, SESSION_COOKIE, webAppleEnabled } from "@/lib/auth";
import type { InvitePreview } from "@/lib/types";
import { serverApi } from "@/lib/server-api";
import { isFreshSession } from "@/lib/session";
import { JoinButton } from "@/screens/JoinButton";

export const dynamic = "force-dynamic";

// 초대 미리보기는 공개 API. generateMetadata 와 화면이 같은 요청을 한 번만 하게 묶는다
const loadInvite = cache((code: string) =>
  serverApi<InvitePreview>(`/invites/${encodeURIComponent(code)}`, { auth: false, from: `/join/${code}` }),
);

// 카카오톡 공유 카드(#154): 팀 이름을 넣은 제목. 실패하면 일반 문구. og:image 는 같은 폴더 opengraph-image.tsx 가 팀 이름을 넣어 그린다 (#159)
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const code = (await params).code.toUpperCase();
  const { data } = await loadInvite(code);
  const title = data ? `${data.groupName} 팀에 초대받았어요` : "초대받았어요";
  const shareTitle = `${title} - ${SITE_NAME}`;
  const description = "링크를 열고 합류하면 같은 달력을 함께 보고, 모두 비는 시간을 바로 찾아요";
  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ko_KR",
      title: shareTitle,
      description,
      url: `/join/${code}`,
    },
    twitter: { card: "summary_large_image", title: shareTitle, description },
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
  const { data, error } = await loadInvite(code);

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
      {/* 진입 화면 공통: 바탕 --bg, 로고 32, 제목 28/36, 좌우 24. 브랜드 크기 제목은 로그인만 (#174 L4) */}
      <Symbol size={32} />

      {data ? (
        <>
          <div className="mt-auto pt-16">
            <span className="inline-flex rounded-sm border border-line px-2.5 py-1 text-[12px] font-medium text-soft">
              멤버 {data.memberCount}명
            </span>
          </div>
          <h1 className="mt-3 break-keep text-[28px] font-bold leading-9 tracking-[-0.03em]">
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
                next={joinAutoNext(code)}
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
