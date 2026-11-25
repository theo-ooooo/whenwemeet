"use client";
// (#515) 관리자 화면 뼈대 (D-285). 폰: 위 머리줄 + 가로 탭 줄, 넓은 화면(fold ≥600): 왼쪽 탭 열 + 본문.
// 팀 화면 뼈대(AppShell)와 따로 둔다: 팀을 고를 필요가 없고 표가 넓다
// (#536) 신고 탭에 접수 중 대상 수 배지. 주소가 바뀔 때와 신고 상세에서 처리했을 때(ADMIN_REPORTS_CHANGED) 다시 받는다
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Symbol } from "../Logo";
import { useAdminReportOpenCount } from "@/hooks";
import { ADMIN_REPORTS_CHANGED, ADMIN_TABS, adminBadgeText, adminTabOf } from "@/lib/admin";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = adminTabOf(pathname);
  const open = useAdminReportOpenCount();
  const refetchOpen = open.refetch;
  const seenPath = useRef(pathname);
  useEffect(() => {
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    void refetchOpen();
  }, [pathname, refetchOpen]);
  // 신고 상세에서 처리하면 주소가 그대로라 이벤트로 다시 받는다
  useEffect(() => {
    const onChange = () => void refetchOpen();
    window.addEventListener(ADMIN_REPORTS_CHANGED, onChange);
    return () => window.removeEventListener(ADMIN_REPORTS_CHANGED, onChange);
  }, [refetchOpen]);
  const badge = adminBadgeText(open.data?.openTargets);
  return (
    <div className="min-h-dvh bg-surface fold:grid fold:grid-cols-[200px_minmax(0,1fr)]">
      <header className="pt-[env(safe-area-inset-top)] fold:sticky fold:top-0 fold:h-dvh fold:border-r fold:border-line fold:bg-paper fold:px-3 fold:py-5">
        <div className="flex h-[52px] items-center gap-2 px-4 fold:h-auto fold:px-2">
          <Link href="/" aria-label="언제볼까 홈" className="hit grid size-[30px] place-items-center rounded-sm">
            <Symbol size={30} />
          </Link>
          <b className="text-[17px] font-bold tracking-[-0.02em]">관리자</b>
          <Link href="/me" className="hit ml-auto rounded-sm px-2 py-1 text-[13px] font-semibold text-ink-2 hover:text-ink fold:hidden">
            내 정보
          </Link>
        </div>
        <nav aria-label="관리자 메뉴" className="overflow-x-auto px-4 fold:mt-6 fold:overflow-visible fold:px-0">
          <ul className="flex gap-1.5 pb-2 fold:flex-col fold:gap-1 fold:pb-0">
            {ADMIN_TABS.map((t) => {
              const on = current === t.href;
              const count = t.href === "/admin/reports" ? badge : null;
              return (
                <li key={t.href} className="shrink-0">
                  <Link
                    href={t.href}
                    aria-current={on ? "page" : undefined}
                    className={`flex h-9 items-center rounded-[18px] px-3.5 text-[14px] font-bold fold:h-10 fold:rounded-md ${
                      on ? "bg-ink text-on-ink" : "bg-paper text-ink-2 hover:text-ink fold:bg-transparent fold:hover:bg-hover"
                    }`}
                  >
                    {t.label}
                    {count && (
                      <span
                        aria-label={`접수 중 ${count}건`}
                        className={`ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none ${on ? "bg-paper text-ink" : "bg-btn text-on-btn"}`}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <Link href="/me" className="mt-6 hidden rounded-md px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-hover hover:text-ink fold:block">
          ‹ 내 정보로
        </Link>
      </header>
      <main className="min-w-0 px-4 pb-16 pt-2 fold:px-8 fold:py-7">
        <div className="mx-auto w-full max-w-[1440px]">{children}</div>
      </main>
    </div>
  );
}

/** 관리자 화면 제목 줄: 제목 20/700 + 오른쪽 동작(새 공지 등) */
export function AdminTitle({ title, right, sub }: { title: string; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-3 flex min-h-11 items-center gap-2">
      <div className="min-w-0 flex-1">
        <h1 className="t-title truncate">{title}</h1>
        {sub && <p className="t-sub">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
