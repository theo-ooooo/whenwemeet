"use client";
// (#515) 관리자 화면 훅 (D-285, D-286). 관리자 API(/admin/*) 는 관리자가 아니면 403
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { AdminActionLog, AdminUser, Notice, Page, UserRole } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";
import { useMutation, type MutationOptions } from "./_useMutation";
import { usePaged } from "./_usePaged";
import type { NoticeInput } from "./useNotices";

/** 관리자 공지 목록 (초안 포함) */
export function useAdminNotices(opts?: QueryOptions<Page<Notice>>) {
  return usePaged<Notice>("/admin/notices?limit=50", opts);
}

/** 관리자 공지 하나 (초안도 읽힌다). id 가 null 이면 요청하지 않는다(새 공지) */
export function useAdminNotice(id: number | null, opts?: QueryOptions<Notice>) {
  return useQuery<Notice>(id === null ? null : `/admin/notices/${id}`, opts);
}

export function useCreateNotice(opts?: MutationOptions) {
  const fn = useCallback((input: NoticeInput) => api<Notice>("/admin/notices", { method: "POST", body: input }), []);
  return useMutation<NoticeInput, Notice>(fn, opts);
}

export function useUpdateNotice(opts?: MutationOptions) {
  const fn = useCallback(
    ({ id, ...input }: Partial<NoticeInput> & { id: number }) => api<Notice>(`/admin/notices/${id}`, { method: "PATCH", body: input }),
    [],
  );
  return useMutation<Partial<NoticeInput> & { id: number }, Notice>(fn, opts);
}

export function useDeleteNotice(opts?: MutationOptions) {
  const fn = useCallback((id: number) => api<{ ok: true }>(`/admin/notices/${id}`, { method: "DELETE" }), []);
  return useMutation<number, { ok: true }>(fn, opts);
}

/** 사용자 목록. q 는 닉네임 검색 (빈 값이면 전체) */
export function useAdminUsers(q: string, opts?: QueryOptions<Page<AdminUser>>) {
  const query = q.trim();
  return usePaged<AdminUser>(`/admin/users?limit=20${query ? `&q=${encodeURIComponent(query)}` : ""}`, { debounceMs: 250, ...opts });
}

export function useUpdateUserRole(opts?: MutationOptions) {
  const fn = useCallback(({ id, role }: { id: number; role: UserRole }) => api<AdminUser>(`/admin/users/${id}/role`, { method: "PATCH", body: { role } }), []);
  return useMutation<{ id: number; role: UserRole }, AdminUser>(fn, opts);
}

/** 조치 기록 (읽기 전용) */
export function useAdminLogs(opts?: QueryOptions<Page<AdminActionLog>>) {
  return usePaged<AdminActionLog>("/admin/logs?limit=30", opts);
}
