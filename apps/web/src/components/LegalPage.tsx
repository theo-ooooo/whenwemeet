import Link from "next/link";
import { Logo } from "./Logo";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-full w-full max-w-[480px] px-5 pb-16 pt-6">
      <Link href="/" className="inline-flex items-center gap-2 rounded-sm" aria-label="언제볼까 홈">
        <Logo variant="symbol" size={28} />
      </Link>
      <h1 className="t-title mt-6">{title}</h1>
      <p className="t-sub mt-1">시행일 {updated}</p>
      <article
        className="mt-6 rounded-lg bg-paper px-5 py-5 [&_h2]:mt-6 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2:first-child]:mt-0 [&_li]:mt-1 [&_p]:mt-2 [&_p]:text-[14px] [&_p]:leading-relaxed [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-[14px]"
      >
        {children}
      </article>
      <p className="t-sub mt-6">
        <Link href="/terms" className="underline underline-offset-2">
          이용약관
        </Link>
        <span aria-hidden="true" className="mx-2">
          |
        </span>
        <Link href="/privacy" className="underline underline-offset-2">
          개인정보처리방침
        </Link>
      </p>
    </main>
  );
}
