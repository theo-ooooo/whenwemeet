"use client";
// (#515) 관리자 화면 훅 (D-285, D-286). 관리자 API(/admin/*) 는 관리자가 아니면 403
import { useCallback } from "react";
import { api } from "@/lib/api";
import type {
  AdminActionLog,
  AdminEvent,
  AdminEventDetail,
  AdminGroup,
  AdminGroupDetail,
  AdminReportGroup,
  AdminReportTarget,
  AdminStats,
  AdminStatsRange,
  AdminUser,
  AdminUserDetail,
  Notice,
  Page,
  ReportStatus,
  ReportTargetType,
  UserRole,
} from "@/lib/types";
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
/** (#528) platform 은 ios, android, web 중 하나 (null = 전체) */
export function useAdminUsers(q: string, platform: "ios" | "android" | "web" | null = null, opts?: QueryOptions<Page<AdminUser>>) {
  const params = new URLSearchParams({ limit: "20" });
  const query = q.trim();
  if (query) params.set("q", query);
  if (platform) params.set("platform", platform);
  return usePaged<AdminUser>(`/admin/users?${params.toString()}`, { debounceMs: 250, ...opts });
}

export function useUpdateUserRole(opts?: MutationOptions) {
  const fn = useCallback(({ id, role }: { id: number; role: UserRole }) => api<AdminUser>(`/admin/users/${id}/role`, { method: "PATCH", body: { role } }), []);
  return useMutation<{ id: number; role: UserRole }, AdminUser>(fn, opts);
}

/** 조치 기록 (읽기 전용) */
export function useAdminLogs(opts?: QueryOptions<Page<AdminActionLog>>) {
  return usePaged<AdminActionLog>("/admin/logs?limit=30", opts);
}

/** (#515) 사용자 상세 (속한 팀) */
export function useAdminUser(id: number, opts?: QueryOptions<AdminUserDetail>) {
  return useQuery<AdminUserDetail>(`/admin/users/${id}`, opts);
}

/** (#515) 팀 목록. q 는 팀 이름 검색 */
/** (#528) type 은 TEAM, PERSONAL 중 하나 (null = 전체). q 는 팀 이름, 개인 달력은 주인 닉네임도 */
export function useAdminGroups(q: string, type: "TEAM" | "PERSONAL" | null = null, opts?: QueryOptions<Page<AdminGroup>>) {
  const params = new URLSearchParams({ limit: "20" });
  const query = q.trim();
  if (query) params.set("q", query);
  if (type) params.set("type", type);
  return usePaged<AdminGroup>(`/admin/groups?${params.toString()}`, { debounceMs: 250, ...opts });
}

export function useAdminGroup(id: number, opts?: QueryOptions<AdminGroupDetail>) {
  return useQuery<AdminGroupDetail>(`/admin/groups/${id}`, opts);
}

/** (#515) 일정 목록. q 는 제목 검색, groupId 는 그 팀만 */
export function useAdminEvents(q: string, groupId: number | null, opts?: QueryOptions<Page<AdminEvent>>) {
  const query = q.trim();
  const params = new URLSearchParams({ limit: "20" });
  if (query) params.set("q", query);
  if (groupId !== null) params.set("groupId", String(groupId));
  return usePaged<AdminEvent>(`/admin/events?${params.toString()}`, { debounceMs: 250, ...opts });
}

export function useAdminEvent(id: number, opts?: QueryOptions<AdminEventDetail>) {
  return useQuery<AdminEventDetail>(`/admin/events/${id}`, opts);
}

type Target = "groups" | "events";

/** (#515) 숨기기(사유 필수). target 은 groups 또는 events */
export function useHideTarget<T>(target: Target, opts?: MutationOptions) {
  const fn = useCallback(({ id, reason }: { id: number; reason: string }) => api<T>(`/admin/${target}/${id}/hide`, { method: "POST", body: { reason } }), [target]);
  return useMutation<{ id: number; reason: string }, T>(fn, opts);
}

export function useUnhideTarget<T>(target: Target, opts?: MutationOptions) {
  const fn = useCallback((id: number) => api<T>(`/admin/${target}/${id}/unhide`, { method: "POST" }), [target]);
  return useMutation<number, T>(fn, opts);
}

/** (#515) 삭제. 팀은 모든 멤버에게서 지워진다 */
export function useDeleteTarget(target: Target, opts?: MutationOptions) {
  const fn = useCallback((id: number) => api<{ ok: true }>(`/admin/${target}/${id}`, { method: "DELETE" }), [target]);
  return useMutation<number, { ok: true }>(fn, opts);
}

/** (#536) 신고 목록 (대상별 묶음). status 가 null 이면 전체 */
export function useAdminReports(status: ReportStatus | null, targetType: ReportTargetType | null = null, opts?: QueryOptions<Page<AdminReportGroup>>) {
  const params = new URLSearchParams({ limit: "20" });
  if (status) params.set("status", status);
  if (targetType) params.set("targetType", targetType);
  return usePaged<AdminReportGroup>(`/admin/reports?${params.toString()}`, opts);
}

/** (#536) 신고 대상 하나 (신고 목록과 미리 보기) */
export function useAdminReportTarget(targetType: ReportTargetType, targetId: number, opts?: QueryOptions<AdminReportTarget>) {
  return useQuery<AdminReportTarget>(`/admin/reports/targets/${targetType}/${targetId}`, opts);
}

/** (#536) 탭 배지: 접수 중 신고가 있는 대상 수 */
export function useAdminReportOpenCount(opts?: QueryOptions<{ openTargets: number }>) {
  return useQuery<{ openTargets: number }>("/admin/reports/open-count", opts);
}

/** (#536) 처리 완료(메모 필수) 또는 기각(메모 선택). 그 대상의 접수 중 신고가 모두 닫힌다 */
export function useCloseReport(kind: "resolve" | "dismiss", opts?: MutationOptions) {
  const fn = useCallback(
    ({ id, resolution }: { id: number; resolution: string }) =>
      api<AdminReportTarget>(`/admin/reports/${id}/${kind}`, { method: "POST", body: kind === "dismiss" && !resolution ? {} : { resolution } }),
    [kind],
  );
  return useMutation<{ id: number; resolution: string }, AdminReportTarget>(fn, opts);
}

/** (#537) 대시보드 지표 (서버 60초 캐시) */
export function useAdminStats(range: AdminStatsRange, opts?: QueryOptions<AdminStats>) {
  return useQuery<AdminStats>(`/admin/stats?range=${range}`, opts);
}
