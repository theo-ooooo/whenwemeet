"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { CalendarKind } from "@/lib/lunar";
import type { AnniversaryReminder, BirthdaySettings } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** (#305) 내 생일 PATCH /me/birthday. date 'MM-DD' 또는 null(지우기), reminders 생략은 그대로. (#562) calendar 생략은 양력, 윤달은 음력만 */
export function useUpdateBirthday(opts?: MutationOptions) {
  const fn = useCallback(
    (input: { date: string | null; reminders?: AnniversaryReminder[]; calendar?: CalendarKind; isLeapMonth?: boolean }) => api<BirthdaySettings>("/me/birthday", { method: "PATCH", body: input }),
    [],
  );
  return useMutation(fn, opts);
}
