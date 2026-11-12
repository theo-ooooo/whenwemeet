"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { StartCalendar } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** (#300) 처음 여는 달력 변경 PATCH /me/start-calendar. GROUP 일 때만 groupId */
export function useUpdateStartCalendar(opts?: MutationOptions) {
  const fn = useCallback((input: StartCalendar) => api<StartCalendar>("/me/start-calendar", { method: "PATCH", body: input }), []);
  return useMutation(fn, opts);
}
