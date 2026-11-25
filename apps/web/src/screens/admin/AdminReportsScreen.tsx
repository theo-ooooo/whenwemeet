"use client";
// (#536) 관리자 신고 목록 (D-289). 신고를 대상(팀, 일정, 사용자)별로 묶어 가장 최근 신고가 늦은 대상 먼저.
// 상태 필터 접수 | 처리 완료 | 기각 | 전체 (기본 접수, 주소 ?status=), 종류 필터 (주소 ?type=). 줄을 누르면 대상 상세
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AdminTitle } from "@/components/admin/AdminShell";
import { IconBell } from "@/components/icons";
import { EmptyState, ErrorState, Segmented, SkeletonList } from "@/components/ui";
import { messageOf, useAdminReports } from "@/hooks";
import { ADMIN_REPORT_FILTERS, adminDateTime, adminReportFilterOf, adminReportHref, reportStatusLabel, reportTargetTypeLabel, type AdminReportFilter } from "@/lib/admin";
import { reportReasonLabel } from "@/lib/report";
import type { AdminReportGroup, ReportTargetType } from "@/lib/types";
import { AdminMore, StatusBadge } from "./AdminMore";

type TypeFilter = "all" | ReportTargetType;
const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "group", label: "팀" },
  { value: "event", label: "일정" },
  { value: "user", label: "사용자" },
];
const typeFilterOf = (raw: string | null): TypeFilter => (raw === "group" || raw === "event" || raw === "user" ? raw : "all");

/** 대상 이름. 지워진 대상은 "지워진 일정" 처럼 */
export function reportTargetTitle(g: Pick<AdminReportGroup, "targetType" | "target">): string {
  return g.target ? g.target.title : `지워진 ${reportTargetTypeLabel(g.targetType)}`;
}

export function ReportStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={status === "open" ? "warn" : status === "resolved" ? "on" : "off"}>{reportStatusLabel(status)}</StatusBadge>;
}

export function AdminReportsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = adminReportFilterOf(params.get("status"));
  const type = typeFilterOf(params.get("type"));
  const q = useAdminReports(status === "all" ? null : status, type === "all" ? null : type);

  function setParam(key: "status" | "type", value: string, fallback: string) {
    const query = new URLSearchParams(params.toString());
    if (value === fallback) query.delete(key);
    else query.set(key, value);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div>
      <AdminTitle title="신고" sub="같은 대상의 신고는 한 줄로 묶어요. 처리하면 그 대상의 접수 중 신고가 모두 닫혀요" />
      <div className="mb-3 flex flex-col gap-2 fold:flex-row fold:items-center">
        <div className="fold:w-[360px] fold:shrink-0">
          <span id="admin-report-status" className="sr-only">
            상태
          </span>
          <Segmented labelledBy="admin-report-status" value={status} options={ADMIN_REPORT_FILTERS} onChange={(v: AdminReportFilter) => setParam("status", v, "open")} />
        </div>
        <div className="fold:w-[300px] fold:shrink-0">
          <span id="admin-report-type" className="sr-only">
            대상 종류
          </span>
          <Segmented labelledBy="admin-report-type" value={type} options={TYPE_FILTERS} onChange={(v) => setParam("type", v, "all")} />
        </div>
      </div>
      {q.error && !q.items ? (
        <ErrorState message={messageOf(q.error, "신고를 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !q.items ? (
        <SkeletonList />
      ) : q.items.length === 0 ? (
        <EmptyState icon={<IconBell size={20} />} title={status === "open" ? "처리할 신고가 없어요" : "해당하는 신고가 없어요"}>
          {status === "open" ? "새 신고가 들어오면 여기에 보여요" : "상태나 종류를 바꿔 보세요"}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl bg-paper px-4">
          {q.items.map((g) => (
            <li key={`${g.targetType}:${g.targetId}`}>
              <Link href={adminReportHref(g.targetType, g.targetId)} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:brightness-95">
                <span className="w-14 shrink-0">
                  <StatusBadge tone="off">{reportTargetTypeLabel(g.targetType)}</StatusBadge>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <b className={`truncate text-[14px] font-semibold ${g.target ? "" : "text-ink-2"}`}>{reportTargetTitle(g)}</b>
                    {g.target?.hidden && <StatusBadge tone="warn">숨김</StatusBadge>}
                  </span>
                  <span className="t-sub block truncate">
                    {g.target?.group ? `${g.target.group.name}, ` : ""}
                    {g.reasons.map((r) => `${reportReasonLabel(r.reason)} ${r.count}`).join(", ")}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-bold tabular-nums">
                  {g.count}건{g.status !== "open" && g.openCount > 0 ? <span className="t-sub font-semibold"> (접수 {g.openCount})</span> : null}
                </span>
                <span className="hidden w-40 shrink-0 text-right text-[13px] tabular-nums text-ink-2 fold:block">{adminDateTime(g.lastReportedAt)}</span>
                <span className="w-16 shrink-0 text-right">
                  <ReportStatusBadge status={g.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <AdminMore q={q} />
    </div>
  );
}
