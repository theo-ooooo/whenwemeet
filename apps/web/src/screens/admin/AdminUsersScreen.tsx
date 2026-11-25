"use client";
// (#515) 관리자 사용자 목록 (최근 가입 먼저, 닉네임 검색) 과 역할 바꾸기. 내 역할은 바꿀 수 없다(버튼 끔, API 도 403)
import Link from "next/link";
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { IconSearch } from "@/components/icons";
import { Button, ConfirmDialog, EmptyState, ErrorState, InlineError, SkeletonList, inputClass } from "@/components/ui";
import { messageOf, useAdminUsers, useMe, useUpdateUserRole } from "@/hooks";
import { adminDateTime, providerText } from "@/lib/admin";
import type { AdminUser } from "@/lib/types";
import { AdminMore, StatusBadge } from "./AdminMore";

export function AdminUsersScreen() {
  const [text, setText] = useState("");
  const q = useAdminUsers(text);
  const myId = useMe().data?.id ?? null;
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { mutate, isPending } = useUpdateUserRole();

  async function changeRole() {
    if (!target) return;
    const role = target.role === "admin" ? "user" : "admin";
    const r = await mutate({ id: target.id, role });
    setTarget(null);
    if (!r.ok) {
      setError(messageOf(r.error, "역할을 바꾸지 못했어요"));
      return;
    }
    setError(null);
    q.setItems((items) => items.map((u) => (u.id === r.data.id ? r.data : u)));
  }

  return (
    <div>
      <AdminTitle title="사용자" />
      <label className="relative mb-3 block">
        <span className="sr-only">이름으로 찾기</span>
        <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
        <input type="search" className={`${inputClass} bg-paper pl-10`} placeholder="이름으로 찾기" value={text} maxLength={50} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && <InlineError className="mb-2">{error}</InlineError>}
      {q.error && !q.items ? (
        <ErrorState message={messageOf(q.error, "사용자를 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !q.items ? (
        <SkeletonList />
      ) : q.items.length === 0 ? (
        <EmptyState icon={<IconSearch size={20} />} title="찾는 사용자가 없어요">
          이름을 바꿔 다시 찾아 보세요
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl bg-paper px-4">
          {q.items.map((u) => {
            const self = u.id === myId;
            return (
              <li key={u.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <span className="w-12 shrink-0 text-[12px] tabular-nums text-ink-2">#{u.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <Link href={`/admin/users/${u.id}`} className="truncate text-[14px] font-semibold underline-offset-2 hover:underline">
                      {u.nickname}
                    </Link>
                    {u.role === "admin" ? <StatusBadge tone="warn">관리자</StatusBadge> : <StatusBadge tone="off">사용자</StatusBadge>}
                    {self && <span className="text-[11px] font-bold text-ink-2">나</span>}
                  </span>
                  <span className="t-sub block">
                    가입 {adminDateTime(u.createdAt)}, {providerText(u.providers)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={self}
                  title={self ? "내 역할은 바꿀 수 없어요" : undefined}
                  onClick={() => setTarget(u)}
                >
                  {u.role === "admin" ? "사용자로" : "관리자로"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <AdminMore q={q} />
      <ConfirmDialog
        open={target !== null}
        title={target?.role === "admin" ? `${target.nickname} 님을 사용자로 바꿀까요?` : `${target?.nickname ?? ""} 님을 관리자로 바꿀까요?`}
        body={target?.role === "admin" ? "관리자 화면에 더 이상 들어올 수 없어요" : "공지 작성, 사용자 역할 변경, 팀과 일정 숨김, 삭제를 할 수 있게 돼요"}
        confirmLabel="바꾸기"
        neutral
        loading={isPending}
        onConfirm={() => void changeRole()}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
