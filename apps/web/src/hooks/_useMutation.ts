"use client";
// 변경 훅 공통. 자원별 훅(useCreateEvent 등)만 이 파일을 쓴다.
// mutate 는 throw 하지 않고 { ok, data, error } 로 결과를 돌려준다. 화면은 ok 로 분기한다.
import { useCallback, useState } from "react";
import { toFailure, type ApiFailure } from "./_error";

export type MutationOutcome<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: ApiFailure };

export type MutationOptions = {
  /** 성공 뒤 화면 이동이 따라오는 변경(팀 만들기, 합류, 일정 저장, 탈퇴)은 이동 중 재클릭을 막기 위해 isPending 을 유지한다 */
  keepPendingAfterSuccess?: boolean;
};

export type MutationResult<TInput, TOutput> = {
  mutate: (input: TInput) => Promise<MutationOutcome<TOutput>>;
  isPending: boolean;
  /** 마지막 실패. 새 mutate 가 시작되면 지워진다 */
  error: ApiFailure | null;
};

export function useMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  opts: MutationOptions = {},
): MutationResult<TInput, TOutput> {
  const { keepPendingAfterSuccess = false } = opts;
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  const mutate = useCallback(
    async (input: TInput): Promise<MutationOutcome<TOutput>> => {
      setPending(true);
      setError(null);
      try {
        const data = await fn(input);
        if (!keepPendingAfterSuccess) setPending(false);
        return { ok: true, data, error: null };
      } catch (e) {
        const failure = toFailure(e);
        setError(failure);
        setPending(false);
        return { ok: false, data: null, error: failure };
      }
    },
    [fn, keepPendingAfterSuccess],
  );

  return { mutate, isPending, error };
}
