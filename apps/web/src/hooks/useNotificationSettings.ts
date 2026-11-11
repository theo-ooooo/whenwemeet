"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { NotificationSettings } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";
import { useQuery, type QueryOptions } from "./_useQuery";

/** (#188) 알림 종류 설정 GET /me/notification-settings */
export function useNotificationSettings(opts?: QueryOptions<NotificationSettings>) {
  return useQuery<NotificationSettings>("/me/notification-settings", opts);
}

/** (#188) 알림 종류 설정 변경 PATCH /me/notification-settings (바꾼 키만) */
export function useUpdateNotificationSettings(opts?: MutationOptions) {
  const fn = useCallback(
    (input: Partial<NotificationSettings>) => api<NotificationSettings>("/me/notification-settings", { method: "PATCH", body: input }),
    [],
  );
  return useMutation(fn, opts);
}
