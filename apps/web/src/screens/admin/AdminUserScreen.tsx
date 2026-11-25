"use client";
// (#515) 관리자 사용자 상세: 기본 정보와 속한 팀 (역할 바꾸기는 목록에서)
import Link from "next/link";
import { AdminTitle } from "@/components/admin/AdminShell";
import { ErrorState, Skeleton } from "@/components/ui";
import { messageOf, useAdminUser } from "@/hooks";
import { adminDateTime, providerText } from "@/lib/admin";
import { StatusBadge } from "./AdminMore";
import { InfoRow } from "./HiddenBox";

export function AdminUserScreen({ id }: { id: number }) {
  const q = useAdminUser(id);
  if (q.error && !q.data) return <ErrorState message={messageOf(q.error, "사용자를 불러오지 못했어요")} onRetry={q.refetch} />;
  if (!q.data) return <Skeleton className="h-[240px] w-full rounded-xl" />;
  const { user, teams } = q.data;
  return (
    <div className="max-w-[720px]">
      <AdminTitle title={user.nickname} sub={`사용자 #${user.id}`} />
      <section className="rounded-xl bg-paper px-4 py-3">
        <dl className="divide-y divide-line">
          <InfoRow label="역할">{user.role === "admin" ? <StatusBadge tone="warn">관리자</StatusBadge> : <StatusBadge tone="off">사용자</StatusBadge>}</InfoRow>
          <InfoRow label="가입">{adminDateTime(user.createdAt)}</InfoRow>
          <InfoRow label="로그인">{providerText(user.providers)}</InfoRow>
        </dl>
      </section>
      <h2 className="mb-2 mt-4 px-1 text-[13px] font-bold text-ink-2">속한 팀 {teams.length}개</h2>
      <ul className="divide-y divide-line rounded-xl bg-paper px-4">
        {teams.map((g) => (
          <li key={g.id}>
            <Link href={`/admin/teams/${g.id}`} className="flex min-h-12 items-center gap-2 py-2.5 hover:brightness-95">
              <b className="min-w-0 truncate text-[14px] font-semibold">{g.name}</b>
              <StatusBadge tone="off">{g.type === "PERSONAL" ? "개인" : "팀"}</StatusBadge>
              {g.hidden && <StatusBadge tone="warn">숨김</StatusBadge>}
              <span className="t-sub ml-auto shrink-0">멤버 {g.memberCount}명, 일정 {g.eventCount}개</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
