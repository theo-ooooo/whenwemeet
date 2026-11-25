"use client";
// (#515) 관리자 팀 목록 (최근 만든 것 먼저, 이름 검색, D-286). 줄을 누르면 상세
import Link from "next/link";
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { IconSearch, IconTeam } from "@/components/icons";
import { EmptyState, ErrorState, SkeletonList, inputClass } from "@/components/ui";
import { messageOf, useAdminGroups } from "@/hooks";
import { adminDateTime } from "@/lib/admin";
import { AdminMore, StatusBadge } from "./AdminMore";

export function AdminTeamsScreen() {
  const [text, setText] = useState("");
  const q = useAdminGroups(text);
  return (
    <div>
      <AdminTitle title="팀" />
      <label className="relative mb-3 block">
        <span className="sr-only">팀 이름으로 찾기</span>
        <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
        <input type="search" className={`${inputClass} bg-paper pl-10`} placeholder="팀 이름으로 찾기" value={text} maxLength={50} onChange={(e) => setText(e.target.value)} />
      </label>
      {q.error && !q.items ? (
        <ErrorState message={messageOf(q.error, "팀을 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !q.items ? (
        <SkeletonList />
      ) : q.items.length === 0 ? (
        <EmptyState icon={<IconTeam size={20} />} title="찾는 팀이 없어요">
          이름을 바꿔 다시 찾아 보세요
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl bg-paper px-4">
          {q.items.map((g) => (
            <li key={g.id}>
              <Link href={`/admin/teams/${g.id}`} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:brightness-95">
                <span className="w-12 shrink-0 text-[12px] tabular-nums text-ink-2">#{g.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <b className="truncate text-[14px] font-semibold">{g.name}</b>
                    <StatusBadge tone="off">{g.type === "PERSONAL" ? "개인" : "팀"}</StatusBadge>
                    {g.hidden ? <StatusBadge tone="warn">숨김</StatusBadge> : <StatusBadge tone="on">정상</StatusBadge>}
                  </span>
                  <span className="t-sub block">
                    멤버 {g.memberCount}명, 일정 {g.eventCount}개, 만든 날 {adminDateTime(g.createdAt).slice(0, 10)}
                  </span>
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
