import Link from "next/link";
import { Symbol } from "./Logo";

/** 약관류 본문 카드 (제목, 문단, 목록 글꼴을 한곳에서). 고객 지원 화면은 절마다 이 카드를 쓴다 */
export const legalCardClass =
  "rounded-xl bg-paper px-4 py-5 [&_h2]:mt-5 [&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:leading-5 [&_h2:first-child]:mt-0 [&_h3]:mt-4 [&_h3]:text-[14px] [&_h3]:font-bold [&_h3]:leading-5 [&_li]:mt-1 [&_p]:mt-2 [&_p]:text-[14px] [&_p]:leading-[22px] [&_p]:text-soft [&_ul]:text-soft [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-[14px] [&_ol]:text-soft [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:text-[14px]";

export function LegalPage({
  title,
  updated,
  card = true,
  children,
}: {
  title: string;
  /** 시행일. 약관류가 아닌 페이지(고객 지원)는 비운다 */
  updated?: string;
  /** false 면 본문을 카드 하나로 감싸지 않는다 (children 이 절마다 카드를 직접 그린다) */
  card?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[640px] px-4 pb-16 pt-[max(20px,var(--sat))]">
      <Link href="/" className="inline-flex items-center gap-2 rounded-sm px-1.5" aria-label="언제볼까 홈">
        <Symbol size={32} />
      </Link>
      <h1 className="t-title mt-4 px-1">{title}</h1>
      {updated && <p className="t-sub mt-0.5 px-1">시행일 {updated}</p>}
      {card ? <article className={`mt-3 ${legalCardClass}`}>{children}</article> : <div className="mt-3 space-y-2">{children}</div>}
      <p className="t-sub mt-4 px-1">
        <Link href="/terms" className="underline underline-offset-2">
          이용약관
        </Link>
        <span aria-hidden="true" className="mx-2">
          |
        </span>
        <Link href="/privacy" className="underline underline-offset-2">
          개인정보처리방침
        </Link>
        <span aria-hidden="true" className="mx-2">
          |
        </span>
        <Link href="/support" className="underline underline-offset-2">
          고객 지원
        </Link>
      </p>
    </main>
  );
}
