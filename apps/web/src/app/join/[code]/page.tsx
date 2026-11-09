import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Symbol } from "@/components/Logo";
import { KakaoButton } from "@/components/KakaoButton";
import { Button } from "@/components/ui";
import { SESSION_COOKIE } from "@/lib/auth";
import type { InvitePreview } from "@/lib/types";
import { serverApi } from "@/lib/server-api";
import { JoinButton } from "@/screens/JoinButton";

export const metadata: Metadata = { title: "초대" };
export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();
  const loggedIn = Boolean((await cookies()).get(SESSION_COOKIE)?.value);
  const { data, error } = await serverApi<InvitePreview>(`/invites/${encodeURIComponent(code)}`, {
    auth: false,
    from: `/join/${code}`,
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
      <Symbol size={40} />

      {data ? (
        <>
          <div className="mt-auto pt-16">
            <span className="inline-flex rounded-full border-[1.5px] border-[var(--chip-line)] px-3 py-[7px] text-[13px] font-semibold text-soft">
              멤버 {data.memberCount}명
            </span>
          </div>
          <h1 className="mt-[22px] break-keep text-[44px] font-extrabold leading-[1.05] tracking-[-0.06em]">
            {data.groupName}
            <br />
            팀에 초대받았어요
          </h1>
          <p className="mt-[18px] text-[16px] font-medium text-soft">합류하면 같은 달력을 함께 보고, 모두 비는 시간을 바로 찾아요</p>
          <div className="mt-10">
            {loggedIn ? (
              <JoinButton code={code} />
            ) : (
              <KakaoButton next={`/join/${code}`} label="카카오로 로그인하고 합류하기" />
            )}
          </div>
        </>
      ) : error?.code === "INVITE_NOT_FOUND" ? (
        <>
          <h1 className="mt-auto text-[34px] font-extrabold leading-[1.1] tracking-[-0.05em]">
            초대 링크가 만료됐거나 잘못됐어요
          </h1>
          <p className="mt-3 text-[16px] font-medium text-soft">초대한 사람에게 새 링크를 받아 주세요</p>
          <Link href="/" className="mt-10 block">
            <Button size="lg" full tabIndex={-1}>
              홈으로
            </Button>
          </Link>
        </>
      ) : (
        <>
          <h1 className="mt-auto text-[34px] font-extrabold leading-[1.1] tracking-[-0.05em]">
            초대 정보를 불러오지 못했어요
          </h1>
          <p className="mb-10 mt-3 text-[16px] font-medium text-soft">{error?.message || "새로고침해 주세요"}</p>
        </>
      )}
    </main>
  );
}
