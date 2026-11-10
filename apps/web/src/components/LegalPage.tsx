import Link from "next/link";
import { Symbol } from "./Logo";

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
    <main className="mx-auto min-h-dvh w-full max-w-[640px] px-4 pb-16 pt-[max(20px,env(safe-area-inset-top))]">
      <Link href="/" className="inline-flex items-center gap-2 rounded-sm px-1.5" aria-label="언제볼까 홈">
        <Symbol size={32} />
      </Link>
      <h1 className="t-title mt-6 px-1.5">{title}</h1>
      <p className="t-sub mt-1.5 px-1.5">시행일 {updated}</p>
      <article
        className="mt-5 rounded-xl bg-paper px-5 py-6 [&_h2]:mt-6 [&_h2]:text-[17px] [&_h2]:font-extrabold [&_h2]:tracking-[-0.02em] [&_h2:first-child]:mt-0 [&_li]:mt-1 [&_p]:mt-2 [&_p]:text-[14px] [&_p]:leading-relaxed [&_p]:text-soft [&_ul]:text-soft [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-[14px]"
      >
        {children}
      </article>
      <p className="t-sub mt-6 px-1.5">
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
