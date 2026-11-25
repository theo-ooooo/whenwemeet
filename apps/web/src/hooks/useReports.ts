"use client";
// (#536) 신고하기 (api.md 2.18, D-289). 하루 10번을 넘으면 429 RATE_LIMITED
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { ReportReason, ReportReceipt, ReportTargetType } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

export type ReportInput = { targetType: ReportTargetType; targetId: number; reason: ReportReason; detail?: string };

export function useCreateReport(opts?: MutationOptions) {
  const fn = useCallback((input: ReportInput) => api<ReportReceipt>("/reports", { method: "POST", body: input }), []);
  return useMutation<ReportInput, ReportReceipt>(fn, opts);
}
