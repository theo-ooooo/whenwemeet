"use client";
// (#276) 7-2 할 일 목록 상세 `/todos/<코드>` (화면흐름.md 7-2, 설계 할일-목록.md 3장, D-209).
// 머리줄 ‹ + 목록 이름 + ⋯(이름 바꾸기, 완료 항목 지우기, 목록 삭제) → 미완료 항목(추가순) → "완료 N개" 접힘 → 맨 아래 입력줄.
// 항목 줄 44: 체크 원(누르는 칸 44, aria-pressed), 글(누르면 제자리 수정), 추가한 사람 색 점, × 삭제(확인 없이 + 5초 되돌리기).
// 폰은 독과 + 를 숨기고(AppShell) 입력줄이 주 동작. 넓은 화면은 본문 전체 폭 한 장 (D-100)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { IconCheck, IconChevronDown, IconChevronLeft, IconClose, IconMore, IconPlus, IconTodo } from "@/components/icons";
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, MemberDot, Sheet, SkeletonList, inputClass } from "@/components/ui";
import { isPendingItem, messageOf, useTodoListEditor, type ApiFailure, type MutationOutcome } from "@/hooks";
import { todosHref } from "@/lib/routes";
import { deleteListPrompt, doneByLabel, splitTodoItems, TODO_ITEM_LIMIT, TODO_ITEM_TEXT_MAX, TODO_LIST_NAME_MAX, todoItemLabel } from "@/lib/todo";
import type { TodoItem, TodoListDetail } from "@/lib/types";

/** 저장 실패 문구. 다른 멤버가 먼저 지웠으면(404) 그 사실을 (화면은 이미 다시 불러오는 중) */
function failMessage(error: ApiFailure, fallback: string): string {
  return error.status === 404 ? "이미 삭제된 항목이에요" : messageOf(error, fallback);
}

export function TodoListScreen({ code, initial }: { code: string; initial?: TodoListDetail | null }) {
  const { groupId, group } = useGroupContext();
  const router = useRouter();
  const toast = useToast();
  const me = group?.me ?? null;
  const editor = useTodoListEditor(groupId, code, me, initial);
  const { list, items } = editor;
  const [menu, setMenu] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"clear" | "delete" | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const split = items ? splitTodoItems(items) : null;
  const full = items !== null && items.length >= TODO_ITEM_LIMIT;

  function report<T>(r: MutationOutcome<T>, fallback: string): boolean {
    if (!r.ok) toast.show(failMessage(r.error, fallback));
    return r.ok;
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !list) return;
    // 저장 뒤 입력칸을 비우고 포커스를 둔다 (엔터로 연속 입력). 화면에는 바로 보인다(낙관적)
    setDraft("");
    inputRef.current?.focus();
    const r = await editor.add(text);
    if (!r.ok) {
      toast.show(failMessage(r.error, "추가하지 못했어요. 다시 시도해 주세요"));
      setDraft((d) => (d === "" ? text : d));
    }
  }

  async function removeItem(item: TodoItem) {
    const r = await editor.remove(item);
    if (!report(r, "삭제하지 못했어요. 다시 시도해 주세요")) return;
    toast.show(`'${item.text}' 을 지웠어요`, {
      actionLabel: "되돌리기",
      onAction: async () => {
        const back = await editor.restore(item);
        if (!back.ok) toast.show(messageOf(back.error, "되돌리지 못했어요. 다시 추가해 주세요"));
      },
    });
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const r = await editor.rename(name);
    if (!r.ok) {
      setRenameError(messageOf(r.error, "이름을 바꾸지 못했어요. 다시 시도해 주세요"));
      return;
    }
    setRenameOpen(false);
  }

  async function clearDone() {
    const r = await editor.clearDone();
    setConfirm(null);
    if (report(r, "지우지 못했어요. 다시 시도해 주세요")) toast.show(`완료한 ${r.data?.count ?? 0}개를 지웠어요`);
  }

  async function deleteList() {
    if (!list) return;
    const r = await editor.deleteList();
    setConfirm(null);
    if (!r.ok && r.error.status !== 404) {
      toast.show(messageOf(r.error, "목록을 지우지 못했어요. 다시 시도해 주세요"));
      return;
    }
    toast.show(`'${list.name}' 목록을 지웠어요`);
    router.push(todosHref());
  }

  // 목록이 없어졌음 (다른 멤버가 지움, 다른 팀 목록)
  if (editor.error?.status === 404) {
    return (
      <div className="pt-1">
        <EmptyState icon={<IconTodo size={20} />} title="이미 삭제된 목록이에요" className="mt-3 py-6">
          <Link href={todosHref()} className="font-bold text-btn">
            할 일 목록으로
          </Link>
        </EmptyState>
      </div>
    );
  }

  const doneCount = split?.done.length ?? 0;

  return (
    <div className="flex min-h-full flex-col pt-1">
      {/* 머리줄: ‹(목록 화면) + 이름 + ⋯ */}
      <div className="mt-1 flex items-center gap-1">
        <Link href={todosHref()} aria-label="할 일 목록으로" className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-sm text-ink hover:bg-hover">
          <IconChevronLeft size={22} />
        </Link>
        <h1 className="t-title min-w-0 flex-1 truncate">{list?.name ?? ""}</h1>
        <button
          type="button"
          onClick={() => setMenu(true)}
          disabled={!list}
          aria-haspopup="dialog"
          aria-label="목록 메뉴"
          className="-mr-2.5 grid size-11 shrink-0 place-items-center rounded-sm text-ink hover:bg-hover"
        >
          <IconMore size={22} />
        </button>
      </div>
      {split && (
        <p className="t-sub mt-0.5">{split.open.length > 0 ? `남은 ${split.open.length}개` : doneCount > 0 ? "다 했어요" : "아직 항목이 없어요"}</p>
      )}

      <div className="mt-3 flex-1">
        {editor.error ? (
          <ErrorState message={messageOf(editor.error, "할 일을 불러오지 못했어요")} onRetry={editor.refetch} />
        ) : split === null || list === null ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            {split.open.length === 0 ? (
              <p className="rounded-xl bg-paper px-4 py-3.5 text-[14px] leading-5 text-ink-2">
                {doneCount > 0 ? "남은 할 일이 없어요. 아래에 더 적을 수 있어요" : "아직 항목이 없어요. 아래 입력칸에 적고 엔터를 누르세요"}
              </p>
            ) : (
              <ul className="rounded-xl bg-paper px-1.5 py-1" aria-label="남은 할 일">
                {split.open.map((item, i) => (
                  <TodoRow key={item.id} item={item} listName={list.name} first={i === 0} editor={editor} onRemove={removeItem} onFail={(r, f) => report(r, f)} />
                ))}
              </ul>
            )}

            {doneCount > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowDone((v) => !v)}
                  aria-expanded={showDone}
                  className="flex h-11 items-center gap-1 rounded-sm px-1 text-[14px] font-semibold text-ink-2 hover:text-ink"
                >
                  완료 {doneCount}개
                  <IconChevronDown size={16} className={`transition-transform duration-200 ${showDone ? "rotate-180" : ""}`} />
                </button>
                {showDone && (
                  <ul className="rounded-xl bg-paper px-1.5 py-1" aria-label="완료한 할 일">
                    {split.done.map((item, i) => (
                      <TodoRow key={item.id} item={item} listName={list.name} first={i === 0} editor={editor} onRemove={removeItem} onFail={(r, f) => report(r, f)} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 맨 아래 입력줄. 엔터로 저장하고 입력칸을 비운 채 포커스를 둔다 */}
      {list && (
        <div className="sticky bottom-0 -mx-5 mt-4 bg-surface px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2 fold:-mx-1 fold:px-1 fold:pb-1">
          <form onSubmit={addItem} className="flex items-center gap-2 rounded-xl bg-paper p-1.5">
            <label htmlFor="todo-new" className="sr-only">
              항목 추가
            </label>
            <input
              id="todo-new"
              ref={inputRef}
              className={`${inputClass} min-w-0 flex-1`}
              value={draft}
              maxLength={TODO_ITEM_TEXT_MAX}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={full ? `항목은 ${TODO_ITEM_LIMIT}개까지 넣을 수 있어요` : "항목 추가"}
              disabled={full}
              enterKeyHint="enter"
              autoComplete="off"
            />
            <Button type="submit" size="md" disabled={full || draft.trim().length === 0} aria-label="항목 추가" className="shrink-0 px-3">
              <IconPlus size={18} strokeWidth={2.2} />
            </Button>
          </form>
        </div>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={list?.name ?? "목록"}>
        <div className="flex flex-col gap-1.5 pb-1">
          <Button
            variant="secondary"
            size="lg"
            full
            onClick={() => {
              setMenu(false);
              setNewName(list?.name ?? "");
              setRenameError(null);
              setRenameOpen(true);
            }}
          >
            이름 바꾸기
          </Button>
          <Button
            variant="secondary"
            size="lg"
            full
            disabled={doneCount === 0}
            onClick={() => {
              setMenu(false);
              setConfirm("clear");
            }}
          >
            완료 항목 지우기{doneCount > 0 ? ` (${doneCount})` : ""}
          </Button>
          <Button
            variant="danger"
            size="lg"
            full
            onClick={() => {
              setMenu(false);
              setConfirm("delete");
            }}
          >
            목록 삭제
          </Button>
        </div>
      </Sheet>

      <Sheet open={renameOpen} onClose={() => setRenameOpen(false)} title="이름 바꾸기">
        <form onSubmit={saveName} className="space-y-3">
          <Field label="이름" hint={`${newName.trim().length}/${TODO_LIST_NAME_MAX}`} error={renameError}>
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={inputClass}
                value={newName}
                maxLength={TODO_LIST_NAME_MAX}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Button type="submit" size="lg" full disabled={newName.trim().length === 0} loading={editor.renaming}>
            저장
          </Button>
        </form>
      </Sheet>

      <ConfirmDialog
        open={confirm === "clear"}
        title={`완료한 ${doneCount}개를 지울까요?`}
        body="지운 항목은 되돌릴 수 없어요"
        confirmLabel="지우기"
        danger
        loading={editor.clearing}
        onConfirm={() => void clearDone()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title={list ? deleteListPrompt(list.name, items?.length ?? 0) : "목록을 지울까요?"}
        body="팀원 모두에게서 사라지고 되돌릴 수 없어요"
        confirmLabel="삭제"
        danger
        loading={editor.deleting}
        onConfirm={() => void deleteList()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

type Editor = ReturnType<typeof useTodoListEditor>;

/** 항목 한 줄 (높이 44). 글을 누르면 제자리 수정: 엔터 저장, Esc 취소, 빈 글이면 삭제 */
function TodoRow({
  item,
  listName,
  first,
  editor,
  onRemove,
  onFail,
}: {
  item: TodoItem;
  listName: string;
  first: boolean;
  editor: Editor;
  onRemove: (item: TodoItem) => void;
  onFail: <T>(r: MutationOutcome<T>, fallback: string) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const pending = isPendingItem(item);
  const sub = item.done ? doneByLabel(item) : null;
  const editRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  async function commit() {
    setEditing(false);
    const next = text.trim();
    if (next === item.text) return;
    if (next === "") {
      onRemove(item);
      return;
    }
    onFail(await editor.edit(item, next), "고치지 못했어요. 다시 시도해 주세요");
  }

  return (
    <li className={`flex min-h-11 items-center gap-1 ${first ? "" : "border-t border-line"}`}>
      <button
        type="button"
        aria-pressed={item.done}
        aria-label={todoItemLabel(listName, item)}
        disabled={pending}
        onClick={async () => onFail(await editor.toggle(item), "저장하지 못했어요. 다시 시도해 주세요")}
        className="grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={`grid size-[22px] place-items-center rounded-full border-2 ${item.done ? "border-ink bg-ink text-on-ink" : "border-faint"}`}
        >
          {item.done && <IconCheck size={14} strokeWidth={2.6} />}
        </span>
      </button>
      {editing ? (
        <input
          ref={editRef}
          aria-label={`${item.text} 고치기`}
          className={`${inputClass} min-w-0 flex-1 py-2`}
          value={text}
          maxLength={TODO_ITEM_TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              setText(item.text);
              setEditing(false);
            }
          }}
          enterKeyHint="done"
        />
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setText(item.text);
            setEditing(true);
          }}
          aria-label={`${item.text}, 고치기`}
          className="min-w-0 flex-1 py-2.5 text-left"
        >
          <span aria-hidden="true" className={`block break-words text-[15px] leading-5 ${item.done ? "text-ink-2 line-through" : "text-ink"}`}>
            {item.text}
          </span>
          {sub && (
            <span aria-hidden="true" className="mt-0.5 block text-[12px] leading-4 text-ink-2">
              {sub}
            </span>
          )}
        </button>
      )}
      {/* 추가한 사람: 색 점 + 스크린 리더 이름 (색만으로 구분하지 않는다) */}
      <span className="flex shrink-0 items-center px-1" title={`${item.creator.displayName}님이 추가`}>
        <MemberDot color={item.creator.color} size={8} />
        <span className="sr-only">{item.creator.displayName}님이 추가</span>
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => onRemove(item)}
        aria-label={`${item.text} 삭제`}
        className="grid size-11 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        <IconClose size={16} />
      </button>
    </li>
  );
}
