"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

export type PushDeviceInput = { token: string; platform: "IOS" | "ANDROID"; appVersion: string };

/** (#188) 이 기기 푸시 토큰 등록 PUT /me/push-devices (푸시-알림.md 7-1). 같은 토큰은 서버가 upsert */
export function useRegisterPushDevice(opts?: MutationOptions) {
  const fn = useCallback((input: PushDeviceInput) => api<{ ok: true }>("/me/push-devices", { method: "PUT", body: input }), []);
  return useMutation(fn, opts);
}

/** (#188) 이 기기 푸시 토큰 해제 DELETE /me/push-devices. 없어도 200 (멱등) */
export function useRemovePushDevice(opts?: MutationOptions) {
  const fn = useCallback((token: string) => api<{ ok: true }>("/me/push-devices", { method: "DELETE", body: { token } }), []);
  return useMutation(fn, opts);
}
