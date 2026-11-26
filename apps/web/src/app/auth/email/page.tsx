// (#245) 메일 링크 착지 /auth/email?token= (이메일-로그인.md 6-4, D-113).
// GET 은 아무것도 소비하지 않는다: inspect 로 상태만 보고, VALID 면 가린 이메일과 [로그인 계속하기](form POST)를 보인다.
// 메일 스캐너가 미리 열어도 링크와 코드가 살아 있게 자동 제출하지 않는다. 세션이 있어도 넘기지 않는다(다른 계정 링크일 수 있다)
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { LinkConfirmForm } from "@/components/LinkConfirmForm";
import { Symbol } from "@/components/Logo";
import { clientIpOf, LINK_TOKEN_RE, linkViewOf, type LinkView } from "@/lib/email-login";
import { webEmailEnabled } from "@/lib/email-route";
import { readEnvelope } from "@/lib/envelope";
import { isMock, upstream } from "@/lib/upstream";

// referrer 는 설계의 no-referrer 대신 same-origin: no-referrer 면 브라우저가 form POST 의 Origin 을 "null" 로 보내
// /auth/email/link 의 Origin 검사(3장 CSRF)에 걸린다. same-origin 도 토큰이 든 주소를 다른 사이트로 보내지 않는다
export const metadata: Metadata = {
  title: "언제볼까 시작하기",
  referrer: "same-origin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

async function inspect(token: string): Promise<{ view: LinkView; emailMasked: string | null }> {
  const h = await headers();
  const r = await upstream({
    method: "POST",
    path: "/auth/email/link/inspect",
    body: JSON.stringify({ token }),
    token: null,
    internal: { clientIp: clientIpOf(h.get("x-forwarded-for"), h.get("x-real-ip")) },
  });
  const env = readEnvelope<{ state?: unknown; emailMasked?: unknown }>(r.status, r.body);
  if (!env.ok) return { view: linkViewOf(env.error?.code), emailMasked: null };
  const view = linkViewOf(typeof env.data?.state === "string" ? env.data.state : null);
  const emailMasked = typeof env.data?.emailMasked === "string" ? env.data.emailMasked : null;
  return { view, emailMasked };
}

export default async function EmailLinkPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  let view: LinkView;
  let emailMasked: string | null = null;
  if (!webEmailEnabled()) view = "off";
  else if (sp.error) view = linkViewOf(sp.error);
  else if (LINK_TOKEN_RE.test(token) || (isMock() && token.startsWith("mock"))) ({ view, emailMasked } = await inspect(token));
  else view = "expired";

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(34px+var(--sab))] pt-[max(60px,var(--sat))]">
      <Symbol size={32} />
      <div className="mt-auto pt-16">
        {view === "valid" ? (
          <>
            <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">언제볼까 시작하기</h1>
            <p className="mt-3 break-keep text-[15px] leading-[22px] text-soft">
              {emailMasked ? (
                <>
                  <b className="break-all font-semibold text-ink">{emailMasked}</b> 계정으로 계속해요
                </>
              ) : (
                "메일로 받은 링크로 계속해요"
              )}
            </p>
            <div className="mt-8">
              <LinkConfirmForm token={token} />
              <p className="mt-3 text-center text-[12px] leading-[18px] text-ink-2">내가 요청한 메일이 아니라면 이 창을 닫아 주세요</p>
            </div>
          </>
        ) : view === "used" ? (
          <>
            <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">이미 사용한 링크예요</h1>
            <p className="mt-3 text-[15px] leading-[22px] text-soft">이 링크로 로그인했다면 바로 시작할 수 있어요.</p>
            <div className="mt-8 flex flex-col gap-2">
              <LinkButton href="/" primary>
                언제볼까 열기
              </LinkButton>
              <Link
                href="/login/email"
                className="hit mx-auto flex h-10 items-center px-2 text-[13.5px] font-semibold text-soft underline-offset-2 hover:underline"
              >
                메일 다시 받기
              </Link>
            </div>
          </>
        ) : view === "expired" ? (
          <>
            <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">링크를 쓸 수 없어요</h1>
            <p className="mt-3 text-[15px] leading-[22px] text-soft">15분이 지났거나 새 메일을 받아서 이 링크는 끝났어요.</p>
            <div className="mt-8">
              <LinkButton href="/login/email" primary>
                메일 다시 받기
              </LinkButton>
            </div>
          </>
        ) : view === "off" ? (
          <>
            <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">지금은 이메일로 로그인할 수 없어요</h1>
            <p className="mt-3 text-[15px] leading-[22px] text-soft">다른 방법으로 로그인해 주세요.</p>
            <div className="mt-8">
              <LinkButton href="/login" primary>
                로그인 화면으로
              </LinkButton>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">링크를 확인하지 못했어요</h1>
            <p className="mt-3 text-[15px] leading-[22px] text-soft">잠시 후 다시 시도해 주세요.</p>
            <div className="mt-8">
              {token ? (
                <LinkButton href={`/auth/email?token=${encodeURIComponent(token)}`} primary>
                  다시 시도
                </LinkButton>
              ) : (
                <LinkButton href="/login/email" primary>
                  메일 다시 받기
                </LinkButton>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function LinkButton({ href, primary, children }: { href: string; primary: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`flex h-12 w-full items-center justify-center rounded-md px-5 text-[15px] font-bold leading-5 hover:brightness-95 ${
        primary ? "bg-btn text-on-btn" : "border border-line bg-paper text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
