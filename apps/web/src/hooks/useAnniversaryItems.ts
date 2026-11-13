"use client";
import { useCallback, useMemo } from "react";
import { withBirthdays } from "@/lib/birthday";
import type { Anniversary } from "@/lib/types";
import type { QueryOptions } from "./_useQuery";
import { useAnniversaries } from "./useAnniversaries";
import { useBirthdays } from "./useBirthdays";

/**
 * (#305) 달력, 다가오는 일정, 사이드바가 보는 "기념일 항목": 기념일 + 멤버 생일 (기념일 모양, lib/birthday.ts).
 * 두 자원 훅을 묶기만 한다. 생일을 못 받으면 기념일만 보여 준다 (오류는 기념일 쪽만)
 */
export function useAnniversaryItems(groupId: number, opts?: Pick<QueryOptions<Anniversary[]>, "enabled">) {
  const anniversariesQ = useAnniversaries(groupId, opts);
  const birthdaysQ = useBirthdays(groupId, opts);
  const data = useMemo(() => withBirthdays(anniversariesQ.data, birthdaysQ.data, groupId), [anniversariesQ.data, birthdaysQ.data, groupId]);
  const refetchAnniversaries = anniversariesQ.refetch;
  const refetchBirthdays = birthdaysQ.refetch;
  const refetch = useCallback(async () => {
    await Promise.all([refetchAnniversaries(), refetchBirthdays()]);
  }, [refetchAnniversaries, refetchBirthdays]);
  return { data, error: anniversariesQ.error, isLoading: anniversariesQ.isLoading, refetch };
}
