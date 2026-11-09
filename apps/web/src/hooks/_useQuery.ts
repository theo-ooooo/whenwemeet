"use client";
// 조회 훅 공통. 자원별 훅(useEvents 등)만 이 파일을 쓴다.
// - 요청 순번 가드: 늦게 온 응답이 최신 상태를 덮지 않는다
// - abort: 새 요청이 시작되거나 화면이 사라지면 이전 요청을 끊는다
// - 오류가 나도 직전 data 는 유지한다 (화면이 스켈레톤으로 되돌아가지 않도록)
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toFailure, type ApiFailure } from "./_error";

export type QueryResult<T> = {
  data: T | null;
  error: ApiFailure | null;
  /** 요청이 진행 중인지. 첫 로딩 판정은 data === null 로도 할 수 있다 */
  isLoading: boolean;
  refetch: () => Promise<void>;
  /** 변경 훅 성공 뒤 서버 재조회 없이 화면 데이터를 맞출 때 (기념일 목록, 팀 이름 등) */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
};

export type QueryOptions<T> = {
  /** false 면 요청하지 않는다 (조건이 아직 불완전할 때) */
  enabled?: boolean;
  /** 서버 컴포넌트가 lib/server-api.ts 로 미리 받은 데이터. 있으면 스켈레톤 없이 보여주고 뒤에서 다시 받는다 */
  initialData?: T | null;
  /** 입력이 바뀐 뒤 요청까지 기다리는 시간(ms). 조건을 연달아 바꾸는 화면용 */
  debounceMs?: number;
};

export function useQuery<T>(path: string | null, opts: QueryOptions<T> = {}): QueryResult<T> {
  const { enabled = true, initialData, debounceMs = 0 } = opts;
  const active = Boolean(path) && enabled;
  const [data, setData] = useState<T | null>(initialData ?? null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [isLoading, setLoading] = useState(active && initialData == null);
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (!path) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path, { signal: c.signal });
      if (my !== seq.current) return;
      setData(d);
      setLoading(false);
    } catch (e) {
      if (my !== seq.current || c.signal.aborted) return;
      setError(toFailure(e));
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    // 효과 본문에서 직접 setState 하지 않도록 마이크로태스크(또는 디바운스 타이머)로 미룬다
    const start = () => {
      if (!cancelled) void run();
    };
    const timer = debounceMs > 0 ? setTimeout(start, debounceMs) : null;
    if (timer === null) queueMicrotask(start);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [run, active, debounceMs]);

  // 화면이 사라지면 진행 중인 요청을 끊는다
  useEffect(() => {
    const holder = ctrl;
    return () => holder.current?.abort();
  }, []);

  return { data, error, isLoading, refetch: run, setData };
}
