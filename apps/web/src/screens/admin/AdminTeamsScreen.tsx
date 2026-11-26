"use client";
// (#515) 관리자 팀 목록 (최근 만든 것 먼저, 이름 검색, D-286). 줄을 누르면 상세
// (#528) 종류 필터 팀 | 개인 달력 | 전체 (기본 팀, 주소 ?type=). 모든 사용자에게 "내 달력" 이 있어 목록이 같은 이름으로 덮이던 것을 가른다.
//   개인 달력은 주인 아바타 + "지우의 개인 달력", 팀은 먼저 들어온 3명 아바타 묶음. 검색은 팀 이름, 개인 달력은 주인 닉네임도
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { IconSearch, IconTeam } from "@/components/icons";
import { AvatarStack } from "@/components/Participants";
import { Avatar, EmptyState, ErrorState, Segmented, SkeletonList, inputClass } from "@/components/ui";
import { messageOf, useAdminGroups } from "@/hooks";
import { ADMIN_GROUP_FILTERS, adminDateTime, adminGroupFilterOf, adminGroupName, adminGroupTypeParam, type AdminGroupFilter } from "@/lib/admin";
import type { AdminGroup } from "@/lib/types";
import { AdminMore, StatusBadge } from "./AdminMore";

const PLACEHOLDER: Record<AdminGroupFilter, string> = {
  team: "팀 이름으로 찾기",
  personal: "주인 닉네임으로 찾기",
  all: "팀 이름이나 개인 달력 주인으로 찾기",
};

/** 줄 앞 아바타: 개인 달력은 주인, 팀은 멤버 3명까지 */
function GroupAvatars({ group }: { group: AdminGroup }) {
  if (group.type === "PERSONAL") {
    return group.owner ? <Avatar member={{ displayName: group.owner.nickname, profileImageUrl: group.owner.profileImageUrl }} size={28} /> : null;
  }
  const members = group.memberPreview.map((p) => ({ userId: p.id, displayName: p.nickname, color: "", profileImageUrl: p.profileImageUrl }));
  return <AvatarStack members={members} size={24} ring="var(--paper)" />;
}

export function AdminTeamsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = adminGroupFilterOf(params.get("type"));
  const [text, setText] = useState("");
  const q = useAdminGroups(text, adminGroupTypeParam(filter));

  function setFilter(next: AdminGroupFilter) {
    const query = new URLSearchParams(params.toString());
    if (next === "team") query.delete("type");
    else query.set("type", next);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div>
      <AdminTitle title="팀" />
      <div className="mb-3 flex flex-col gap-2 fold:flex-row fold:items-center">
        <div className="fold:w-[300px] fold:shrink-0">
          <span id="admin-group-filter" className="sr-only">
            종류
          </span>
          <Segmented labelledBy="admin-group-filter" value={filter} options={ADMIN_GROUP_FILTERS} onChange={setFilter} />
        </div>
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">{PLACEHOLDER[filter]}</span>
          <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
          <input
            type="search"
            className={`${inputClass} bg-paper pl-10`}
            placeholder={PLACEHOLDER[filter]}
            value={text}
            maxLength={50}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>
      {q.error && !q.items ? (
        <ErrorState message={messageOf(q.error, "팀을 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !q.items ? (
        <SkeletonList />
      ) : q.items.length === 0 ? (
        <EmptyState icon={<IconTeam size={20} />} title={filter === "personal" ? "찾는 개인 달력이 없어요" : "찾는 팀이 없어요"}>
          {filter === "personal" ? "닉네임을 바꿔 다시 찾아 보세요" : "이름을 바꾸거나 종류를 전체로 바꿔 보세요"}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl bg-paper px-4">
          {q.items.map((g) => (
            <li key={g.id}>
              <Link href={`/admin/teams/${g.id}`} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:brightness-95">
                <span className="w-12 shrink-0 text-[12px] tabular-nums text-ink-2">#{g.id}</span>
                <span className="flex shrink-0 items-center lg:w-[64px]">
                  <GroupAvatars group={g} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <b className="truncate text-[14px] font-semibold">{adminGroupName(g)}</b>
                    {filter === "all" && <StatusBadge tone="off">{g.type === "PERSONAL" ? "개인" : "팀"}</StatusBadge>}
                    {g.hidden ? <StatusBadge tone="warn">숨김</StatusBadge> : <StatusBadge tone="on">정상</StatusBadge>}
                  </span>
                  <span className="t-sub block lg:hidden">
                    멤버 {g.memberCount}명, 일정 {g.eventCount}개, 만든 날 {adminDateTime(g.createdAt).slice(0, 10)}
                  </span>
                </span>
                {/* 넓은 화면은 열로 나눈다 */}
                <span className="hidden w-24 shrink-0 text-right text-[13px] tabular-nums text-ink-2 lg:block">멤버 {g.memberCount}명</span>
                <span className="hidden w-24 shrink-0 text-right text-[13px] tabular-nums text-ink-2 lg:block">일정 {g.eventCount}개</span>
                <span className="hidden w-32 shrink-0 text-right text-[13px] tabular-nums text-ink-2 lg:block">{adminDateTime(g.createdAt).slice(0, 10)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <AdminMore q={q} />
    </div>
  );
}
