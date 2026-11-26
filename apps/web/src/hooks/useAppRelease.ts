"use client";
// (#539) 앱 업데이트 안내 (D-292). 공개 GET /app/version, 관리자 GET /admin/app-releases, PUT /admin/app-releases/:platform
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { AppRelease } from "@/lib/types";
import { useQuery, type QueryOptions } from "./_useQuery";
import { useMutation, type MutationOptions } from "./_useMutation";

/** 이 기종의 최신, 최소 버전. platform 이 null(앱이 아님)이면 요청하지 않는다 */
export function useAppRelease(platform: "ios" | "android" | null, opts?: QueryOptions<AppRelease>) {
  return useQuery<AppRelease>(platform ? `/app/version?platform=${platform}` : null, opts);
}

/** 관리자: ios, android 둘 다 */
export function useAdminAppReleases(opts?: QueryOptions<AppRelease[]>) {
  return useQuery<AppRelease[]>("/admin/app-releases", opts);
}

/** 관리자 수정 입력. 생략은 그대로, null 은 지움 */
export type AppReleaseInput = { platform: "ios" | "android"; latestVersion: string | null; minVersion: string | null; storeUrl: string | null };

export function useUpdateAppRelease(opts?: MutationOptions) {
  const fn = useCallback(({ platform, ...body }: AppReleaseInput) => api<AppRelease>(`/admin/app-releases/${platform}`, { method: "PUT", body }), []);
  return useMutation<AppReleaseInput, AppRelease>(fn, opts);
}
