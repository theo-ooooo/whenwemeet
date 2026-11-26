"use client";
// (#515) 관리자 일정 목록 (최근 만든 것 먼저, 제목 검색, 팀 번호 필터, D-286). 목록에는 제목만 (메모, 장소는 상세)
// (#528) 팀 칸: 개인 달력이면 "지우의 개인 달력"
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { IconCalendar, IconSearch } from "@/components/icons";
import { EmptyState, ErrorState, SkeletonList, inputClass } from "@/components/ui";
import { messageOf, useAdminEvents } from "@/hooks";
import { adminEventTime, adminGroupName } from "@/lib/admin";
import { parseId } from "@/lib/id";
import { AdminMore, StatusBadge } from "./AdminMore";

export function AdminEventsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const groupId = parseId(params.get("groupId"));
  const [text, setText] = useState("");
  const q = useAdminEvents(text, groupId);

  return (
    <div>
      <AdminTitle
        title="일정"
        sub={
          groupId !== null ? (
            <>
              팀 #{groupId} 일정만{" "}
              <button type="button" onClick={() => router.replace(pathname)} className="font-semibold text-ink underline underline-offset-2">
                전체 보기
              </button>
            </>
          ) : undefined
        }
      />
      <div className="mb-3 flex gap-2">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">제목으로 찾기</span>
          <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
          <input
            type="search"
            className={`${inputClass} bg-paper pl-10`}
            placeholder="제목으로 찾기"
            value={text}
            maxLength={50}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="block w-[104px] shrink-0">
          <span className="sr-only">팀 번호</span>
          <input
            inputMode="numeric"
            className={`${inputClass} bg-paper`}
            placeholder="팀 번호"
            defaultValue={groupId ?? ""}
            onChange={(e) => {
              const id = parseId(e.target.value.trim());
              router.replace(id === null ? pathname : `${pathname}?groupId=${id}`);
            }}
          />
        </label>
      </div>
      {q.error && !q.items ? (
        <ErrorState message={messageOf(q.error, "일정을 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !q.items ? (
        <SkeletonList />
      ) : q.items.length === 0 ? (
        <EmptyState icon={<IconCalendar size={20} />} title="찾는 일정이 없어요">
          제목이나 팀 번호를 바꿔 보세요
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl bg-paper px-4">
          {q.items.map((e) => (
            <li key={e.id}>
              <Link href={`/admin/events/${e.id}`} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:brightness-95">
                <span className="w-12 shrink-0 text-[12px] tabular-nums text-ink-2">#{e.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <b className="truncate text-[14px] font-semibold">{e.title}</b>
                    {e.hidden ? <StatusBadge tone="warn">숨김</StatusBadge> : <StatusBadge tone="on">정상</StatusBadge>}
                  </span>
                  <span className="t-sub block truncate lg:hidden">
                    {adminEventTime(e.startsAt, e.allDay)}, {adminGroupName(e.group)} #{e.group.id}, {e.creator?.nickname ?? "탈퇴한 멤버"}
                  </span>
                </span>
                {/* 넓은 화면은 열로 나눈다 */}
                <span className="hidden w-44 shrink-0 text-[13px] tabular-nums text-ink-2 lg:block">{adminEventTime(e.startsAt, e.allDay)}</span>
                <span className="hidden w-52 shrink-0 truncate text-[13px] text-ink-2 lg:block">
                  {adminGroupName(e.group)} <span className="tabular-nums">#{e.group.id}</span>
                </span>
                <span className="hidden w-32 shrink-0 truncate text-[13px] text-ink-2 lg:block">{e.creator?.nickname ?? "탈퇴한 멤버"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <AdminMore q={q} />
    </div>
  );
}
