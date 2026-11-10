"use client";
// 서버 상태 확인 (GET /api/health). 점검 화면 전용 (#54).
// - 화면이 열리자마자가 아니라 intervalMs 마다 확인한다 (막 장애로 넘어온 직후 바로 되돌아가는 왕복 방지)
// - outageRedirect: false 로 불러 실패해도 점검 화면으로 다시 보내지 않는다 (무한 이동 방지)
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toFailure, type ApiFailure } from "./_error";

export type Health = { ok: boolean };

export function useHealth(opts: { intervalMs: number; enabled?: boolean }) {
  const { intervalMs, enabled = true } = opts;
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [isLoading, setLoading] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    try {
      const d = await api<{ ok?: boolean }>("/health", { signal: c.signal, outageRedirect: false });
      if (c.signal.aborted) return;
      setData({ ok: d?.ok === true });
      setError(null);
    } catch (e) {
      if (c.signal.aborted) return;
      setData({ ok: false });
      setError(toFailure(e));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => void refetch(), intervalMs);
    const holder = ctrl;
    return () => {
      clearInterval(timer);
      holder.current?.abort();
    };
  }, [enabled, intervalMs, refetch]);

  return { data, error, isLoading, refetch };
}
