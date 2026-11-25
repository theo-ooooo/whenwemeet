"use client";
// (#515) 관리자 조치 기록 (읽기 전용, 최근 것 먼저, D-286)
import { AdminTitle } from "@/components/admin/AdminShell";
import { IconClock } from "@/components/icons";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui";
import { messageOf, useAdminLogs } from "@/hooks";
import { adminActionLabel, adminDateTime, adminTargetLabel } from "@/lib/admin";
import { AdminMore } from "./AdminMore";

export function AdminLogsScreen() {
  const q = useAdminLogs();
  return (
    <div>
      <AdminTitle title="기록" sub="관리자가 한 일은 모두 여기에 남아요" />
      {q.error && !q.items ? (
        <ErrorState message={messageOf(q.error, "기록을 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !q.items ? (
        <SkeletonList />
      ) : q.items.length === 0 ? (
        <EmptyState icon={<IconClock size={20} />} title="아직 기록이 없어요" />
      ) : (
        <ul className="divide-y divide-line rounded-xl bg-paper px-4">
          {q.items.map((l) => (
            <li key={l.id} className="flex flex-col gap-0.5 py-3 fold:flex-row fold:items-center fold:gap-3">
              <span className="t-sub shrink-0 tabular-nums fold:w-[124px]">{adminDateTime(l.createdAt)}</span>
              <b className="shrink-0 text-[14px] font-semibold fold:w-[104px]">{adminActionLabel(l.action)}</b>
              <span className="min-w-0 flex-1 text-[14px] text-soft">
                {adminTargetLabel(l.targetType, l.targetId)}
                {l.reason && <span className="text-ink-2">, {l.reason}</span>}
              </span>
              <span className="t-sub shrink-0">{l.admin?.nickname ?? "탈퇴한 관리자"}</span>
            </li>
          ))}
        </ul>
      )}
      <AdminMore q={q} />
    </div>
  );
}
