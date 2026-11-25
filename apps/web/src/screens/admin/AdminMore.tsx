"use client";
// (#515) 관리자 목록 아래 "더 보기" (다음 페이지)와 상태 배지. (#528) 쓰는 곳 배지
import { Button } from "@/components/ui";
import type { PagedResult } from "@/hooks";
import { adminPlatformLabels } from "@/lib/admin";

export function AdminMore<T>({ q }: { q: PagedResult<T> }) {
  if (!q.hasMore) return null;
  return (
    <div className="mt-3">
      <Button variant="outline" full loading={q.loadingMore} onClick={() => void q.loadMore()}>
        더 보기
      </Button>
    </div>
  );
}

/** 상태 표: 게시/초안, 정상/숨김 등 (칩 모서리 5, 11/700) */
export function StatusBadge({ tone, children }: { tone: "on" | "off" | "warn"; children: React.ReactNode }) {
  const cls = tone === "on" ? "bg-hover text-acc-ink" : tone === "warn" ? "bg-hover text-danger" : "border border-line text-ink-2";
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-[5px] px-1.5 text-[11px] font-bold leading-none ${cls}`}>{children}</span>;
}

/** (#528) 쓰는 곳 배지 */
export function PlatformBadges({ platforms }: { platforms: readonly string[] }) {
  return (
    <>
      {adminPlatformLabels(platforms).map((label) => (
        <StatusBadge key={label} tone="off">
          {label}
        </StatusBadge>
      ))}
    </>
  );
}
