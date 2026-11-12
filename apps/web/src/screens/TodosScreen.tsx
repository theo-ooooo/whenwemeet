"use client";
// (#276) 7-1 할 일 목록 `/todos` (화면흐름.md 7-1, 설계 할일-목록.md 3장, D-206).
// 목록 카드 세로 나열(이름, 남은 개수, 마지막으로 바꾼 사람과 시각). 본문 폭 main-lg(≥696) 2열, main-2xl(≥1208) 3열 (D-202).
// + 는 하나만(#170): 폰 + 가 이 화면에서는 "목록 추가", 넓은 화면은 제목줄 오른쪽 버튼. `?new=1` 이면 만들기 시트를 연 채로
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { IconChevronRight, IconPlus, IconTodo } from "@/components/icons";
import { Button, EmptyState, ErrorState, Field, MemberDot, Sheet, Skeleton, inputClass } from "@/components/ui";
import { messageOf, useCreateTodoList, useRefetchOnVisible, useTodoLists } from "@/hooks";
import { formatRelative } from "@/lib/date";
import { todoListHref } from "@/lib/routes";
import { remainingLabel, TODO_LIST_LIMIT, TODO_LIST_NAME_MAX, TODO_SUGGESTIONS } from "@/lib/todo";

export function TodosScreen() {
  const { groupId, setFabAction } = useGroupContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = useTodoLists(groupId);
  useRefetchOnVisible(q.refetch);
  const lists = q.data?.items ?? null;
  const create = useCreateTodoList(groupId, { keepPendingAfterSuccess: true });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [chipError, setChipError] = useState<string | null>(null);
  const full = lists !== null && lists.length >= TODO_LIST_LIMIT;

  function openSheet() {
    setName("");
    setFormError(null);
    setOpen(true);
  }

  // 폰 + 는 목록 추가 (#170). 팀이 바뀌면 화면이 다시 마운트되며 다시 건다
  const openRef = useRef(openSheet);
  useEffect(() => {
    openRef.current = openSheet;
  });
  useEffect(() => {
    setFabAction({ label: "목록 추가", run: () => openRef.current() });
    return () => setFabAction(null);
  }, [setFabAction]);

  // 홈 구역 "목록 만들기"(/todos?new=1): 시트를 열고 주소에서 뗀다 (뒤로가기로 다시 열리지 않게)
  const wantsNew = searchParams.get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    queueMicrotask(() => {
      openRef.current();
      window.history.replaceState(null, "", window.location.pathname);
    });
  }, [wantsNew]);

  async function make(listName: string): Promise<string | null> {
    const r = await create.mutate(listName);
    if (!r.ok) return messageOf(r.error, "목록을 만들지 못했어요. 다시 시도해 주세요");
    router.push(todoListHref(r.data));
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1) return;
    setFormError(await make(trimmed));
  }

  const valid = name.trim().length >= 1 && name.trim().length <= TODO_LIST_NAME_MAX;

  return (
    <div className="pt-1">
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-title">할 일</h1>
          <p className="t-sub mt-0.5">장보기, 여행 준비물처럼 날짜 없이 같이 챙길 것을 적어 두세요</p>
        </div>
        <span className="hidden shrink-0 fold:block">
          <Button size="sm" onClick={openSheet} disabled={full}>
            <IconPlus size={14} strokeWidth={2.2} />
            목록 추가
          </Button>
        </span>
      </div>

      <div className="mt-3">
        {q.error ? (
          <ErrorState message={messageOf(q.error, "할 일을 불러오지 못했어요")} onRetry={q.refetch} />
        ) : lists === null ? (
          <div className="grid gap-3 main-lg:grid-cols-2 main-2xl:grid-cols-3" aria-busy="true" aria-label="불러오는 중">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
            ))}
          </div>
        ) : lists.length === 0 ? (
          <div>
            <EmptyState icon={<IconTodo size={20} />} title="아직 할 일 목록이 없어요">
              장보기, 여행 준비물처럼 같이 챙길 것을 적어 두세요
            </EmptyState>
            {/* 제안 칩: 누르면 그 이름으로 만들고 상세로 */}
            <div className="mt-3 flex flex-wrap justify-center gap-2" role="group" aria-label="이름 제안">
              {TODO_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={create.isPending}
                  onClick={async () => setChipError(await make(s))}
                  className="h-9 rounded-full border border-line bg-paper px-3.5 text-[13.5px] font-semibold text-ink hover:bg-hover disabled:text-ink-2"
                >
                  {s}
                </button>
              ))}
            </div>
            {chipError && (
              <p role="alert" className="mt-2 text-center text-[13px] text-danger">
                {chipError}
              </p>
            )}
          </div>
        ) : (
          <>
            <ul className="grid gap-3 main-lg:grid-cols-2 main-2xl:grid-cols-3">
              {lists.map((l) => {
                const sub = remainingLabel(l);
                const when = `${l.editor.displayName}, ${formatRelative(l.updatedAt)}`;
                return (
                  <li key={l.id} className="min-w-0">
                    <Link
                      href={todoListHref(l)}
                      aria-label={`${l.name}, ${sub}, 마지막 수정 ${when}`}
                      className="flex min-h-[76px] items-center gap-3 rounded-xl bg-paper px-4 py-3 hover:bg-hover"
                    >
                      <span aria-hidden="true" className="min-w-0 flex-1">
                        <b className="block truncate text-[16px] font-bold leading-[22px] tracking-[-0.01em]">{l.name}</b>
                        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-2">
                          <span className={`shrink-0 text-[13px] ${l.openCount > 0 ? "font-semibold text-ink" : ""}`}>{sub}</span>
                          <MemberDot className="ml-1 shrink-0" color={l.editor.color} size={6} />
                          <span className="truncate">{when}</span>
                        </span>
                      </span>
                      <IconChevronRight size={18} className="shrink-0 text-ink-2" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            {full && <p className="t-sub mt-3">목록은 {TODO_LIST_LIMIT}개까지 만들 수 있어요. 다 쓴 목록을 지우면 새로 만들 수 있어요</p>}
          </>
        )}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="목록 추가">
        <form onSubmit={submit} className="space-y-3">
          <Field label="이름" hint={`${name.trim().length}/${TODO_LIST_NAME_MAX}`} error={formError}>
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={inputClass}
                value={name}
                maxLength={TODO_LIST_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 장보기, 여행 준비물"
                autoFocus
              />
            )}
          </Field>
          <Button type="submit" size="lg" full disabled={!valid} loading={create.isPending}>
            만들기
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
