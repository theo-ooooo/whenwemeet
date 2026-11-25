"use client";
// (#515) 관리자 사용자 목록 (최근 가입 먼저, 닉네임 검색) 과 역할 바꾸기. 내 역할은 바꿀 수 없다(버튼 끔, API 도 403)
// (#528) 쓰는 곳 배지(iOS, Android, 웹만, 앱 기종 모름)와 기종 필터(전체 | iOS | Android | 웹만, 주소 ?platform=). 기종은 푸시 기기에서만 안다
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { IconSearch } from "@/components/icons";
import { Avatar, Button, ConfirmDialog, EmptyState, ErrorState, InlineError, Segmented, SkeletonList, inputClass } from "@/components/ui";
import { messageOf, useAdminUsers, useMe, useUpdateUserRole } from "@/hooks";
import { ADMIN_PLATFORM_FILTERS, adminDateTime, adminPlatformFilterOf, providerText, type AdminPlatformFilter } from "@/lib/admin";
import type { AdminUser } from "@/lib/types";
import { AdminMore, PlatformBadges, StatusBadge } from "./AdminMore";

export function AdminUsersScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const platform = adminPlatformFilterOf(params.get("platform"));
  const [text, setText] = useState("");
  const q = useAdminUsers(text, platform === "all" ? null : platform);

  function setPlatform(next: AdminPlatformFilter) {
    const query = new URLSearchParams(params.toString());
    if (next === "all") query.delete("platform");
    else query.set("platform", next);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }
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
      <div className="mb-3 flex flex-col gap-2 fold:flex-row fold:items-center">
        <div className="fold:w-[340px] fold:shrink-0">
          <span id="admin-platform-filter" className="sr-only">
            쓰는 곳
          </span>
          <Segmented labelledBy="admin-platform-filter" value={platform} options={ADMIN_PLATFORM_FILTERS} onChange={setPlatform} />
        </div>
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">이름으로 찾기</span>
          <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
          <input type="search" className={`${inputClass} bg-paper pl-10`} placeholder="이름으로 찾기" value={text} maxLength={50} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
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
                <span className="w-10 shrink-0 text-[12px] tabular-nums text-ink-2">#{u.id}</span>
                <Avatar member={{ displayName: u.nickname, profileImageUrl: u.profileImageUrl }} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <Link href={`/admin/users/${u.id}`} className="truncate text-[14px] font-semibold underline-offset-2 hover:underline">
                      {u.nickname}
                    </Link>
                    {u.role === "admin" ? <StatusBadge tone="warn">관리자</StatusBadge> : <StatusBadge tone="off">사용자</StatusBadge>}
                    {self && <span className="text-[11px] font-bold text-ink-2">나</span>}
                  </span>
                  {/* (#528) 좁은 화면은 이름 아래 줄(이름이 잘리지 않게), 넓은 화면은 열 */}
                  <span className="mt-1 flex flex-wrap items-center gap-1 lg:hidden">
                    <PlatformBadges platforms={u.platforms} />
                  </span>
                  <span className="t-sub block lg:hidden">
                    가입 {adminDateTime(u.createdAt)}, {providerText(u.providers)}
                  </span>
                </span>
                {/* 넓은 화면은 열로 나눈다 */}
                <span className="hidden w-40 shrink-0 items-center gap-1 lg:flex">
                  <PlatformBadges platforms={u.platforms} />
                </span>
                <span className="hidden w-48 shrink-0 truncate text-[13px] text-ink-2 lg:block">{providerText(u.providers)}</span>
                <span className="hidden w-36 shrink-0 text-[13px] tabular-nums text-ink-2 lg:block">가입 {adminDateTime(u.createdAt)}</span>
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
