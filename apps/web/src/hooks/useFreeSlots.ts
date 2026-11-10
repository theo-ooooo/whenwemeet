"use client";
import type { FreeSlots } from "@/lib/types";
import { qs } from "./_error";
import { useQuery, type QueryOptions } from "./_useQuery";

export type FreeSlotsParams = {
  from: string; // ISO
  to: string; // ISO
  dayStart: string; // HH:mm
  dayEnd: string; // HH:mm
  minMinutes: number;
  includeAllDay: boolean;
};

/** 빈 시간 GET /groups/:id/free-slots?... */
export function useFreeSlots(groupId: number, params: FreeSlotsParams, opts?: QueryOptions<FreeSlots>) {
  return useQuery<FreeSlots>(`/groups/${groupId}/free-slots${qs(params)}`, opts);
}
