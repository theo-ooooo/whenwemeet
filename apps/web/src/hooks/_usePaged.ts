"use client";
// (#515) 페이지 넘김 조회 공통 (`?limit=&cursor=` → `{ items, nextCursor }`). 첫 페이지는 useQuery, 다음 페이지는 loadMore 로 이어 붙인다.
// 첫 페이지를 다시 받으면(경로가 바뀌거나 refetch) 붙인 페이지와 고친 줄은 버린다. 자원별 훅(useNotices, useAdminUsers 등)만 이 파일을 쓴다
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";
import { toFailure, type ApiFailure } from "./_error";
import { useQuery, type QueryOptions } from "./_useQuery";

export type PagedResult<T> = {
  /** 첫 페이지를 받기 전에는 null */
  items: T[] | null;
  error: ApiFailure | null;
  isLoading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  /** 변경 훅 성공 뒤 서버 재조회 없이 목록을 맞출 때 */
  setItems: (update: (items: T[]) => T[]) => void;
};

/** path 에 cursor 를 붙인다 (이미 쿼리가 있으면 &) */
export function withCursor(path: string, cursor: number): string {
  return `${path}${path.includes("?") ? "&" : "?"}cursor=${cursor}`;
}

type Local<T> = { base: Page<T>; items: T[]; next: number | null };

export function usePaged<T>(path: string | null, opts: QueryOptions<Page<T>> = {}): PagedResult<T> {
  const first = useQuery<Page<T>>(path, opts);
  const [local, setLocal] = useState<Local<T> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiFailure | null>(null);

  const base = first.data;
  const current = local && base && local.base === base ? local : null;
  const items = current ? current.items : (base?.items ?? null);
  const next = current ? current.next : (base?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!path || !base || next === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api<Page<T>>(withCursor(path, next));
      setLoadingMore(false);
      setLocal({ base, items: [...(items ?? []), ...page.items], next: page.nextCursor });
    } catch (e) {
      setLoadingMore(false);
      setMoreError(toFailure(e));
    }
  }, [path, base, next, items, loadingMore]);

  const setItems = useCallback(
    (update: (list: T[]) => T[]) => {
      if (!base) return;
      setLocal({ base, items: update(items ?? []), next });
    },
    [base, items, next],
  );

  return {
    items,
    error: first.error ?? moreError,
    isLoading: first.isLoading,
    hasMore: next !== null,
    loadingMore,
    loadMore,
    refetch: first.refetch,
    setItems,
  };
}
