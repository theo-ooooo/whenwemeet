"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { useMutation, type MutationOptions } from "./_useMutation";

/** (#562) 달력 칸 음력 표시 PATCH /me/lunar-display (D-297) */
export function useUpdateLunarDisplay(opts?: MutationOptions) {
  const fn = useCallback((showLunar: boolean) => api<{ showLunar: boolean }>("/me/lunar-display", { method: "PATCH", body: { showLunar } }), []);
  return useMutation(fn, opts);
}
