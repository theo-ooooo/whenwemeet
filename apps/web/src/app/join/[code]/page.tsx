import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { KakaoButton } from "@/components/KakaoButton";
import { Button } from "@/components/ui";
import { SESSION_COOKIE } from "@/lib/auth";
import type { InvitePreview } from "@/lib/types";
import { serverApi } from "@/lib/upstream";
import { JoinButton } from "@/screens/JoinButton";

export const metadata: Metadata = { title: "초대" };
export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();
  const loggedIn = Boolean((await cookies()).get(SESSION_COOKIE)?.value);
  const { data, error } = await serverApi<InvitePreview>(`/invites/${encodeURIComponent(code)}`, {
    auth: false,
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[14vh]">
      <Logo variant="symbol" size={56} />

      {data ? (
        <>
          <h1 className="mt-7 text-[28px] font-extrabold leading-[1.2] tracking-[-0.03em]">
            <span className="text-brand">{data.groupName}</span> 팀에
            <br />
            초대받았어요
          </h1>
          <p className="mt-3 text-[15px] text-ink-2">
            지금 멤버 {data.memberCount}명. 합류하면 같은 달력을 함께 봐요
          </p>
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
          <h1 className="mt-7 text-[24px] font-extrabold leading-[1.25] tracking-[-0.02em]">
            초대 링크가 만료됐거나 잘못됐어요
          </h1>
          <p className="mt-3 text-[15px] text-ink-2">초대한 사람에게 새 링크를 받아 주세요</p>
          <Link href="/" className="mt-10 block">
            <Button variant="secondary" size="lg" full tabIndex={-1}>
              홈으로
            </Button>
          </Link>
        </>
      ) : (
        <>
          <h1 className="mt-7 text-[24px] font-extrabold leading-[1.25] tracking-[-0.02em]">
            초대 정보를 불러오지 못했어요
          </h1>
          <p className="mt-3 text-[15px] text-ink-2">{error?.message || "새로고침해 주세요"}</p>
        </>
      )}
    </main>
  );
}
