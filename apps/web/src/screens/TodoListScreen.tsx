"use client";
// (#276) 7-2 할 일 목록 상세 `/todos/<코드>` (화면흐름.md 7-2, 설계 할일-목록.md 3장, D-209).
// (#378) 머리줄 "‹ 목록 이름 ··· ⋯"(ScreenHeader + OverflowMenu: 이름 바꾸기, 완료 항목 지우기, 목록 지우기. 지우기 둘은 확인 창)
//   → 미완료 항목(추가순) + 맨 아래 줄 "항목 추가" 입력(엔터로 계속 추가) → "완료 N개" 접힘.
// 항목 줄 44: 체크 원(누르는 칸 44, aria-pressed), 글(누르면 제자리 수정). (#378) 항목마다 ✕ 를 두지 않는다(체크하려다 지우기 쉬웠다):
//   손가락(터치)은 왼쪽으로 밀어 "삭제" 를 꺼내거나 끝까지 밀어 지우고, 마우스는 줄에 올리거나 키보드로 갔을 때만 ✕ 가 보인다.
//   지운 뒤 5초 되돌리기는 그대로. 추가한 사람 색 점은 뜻이 안 읽혀 뺐다
// 폰은 독과 + 를 숨긴다(AppShell). 넓은 화면은 본문 전체 폭 한 장 (D-100)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { OverflowMenu } from "@/components/OverflowMenu";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { IconCheck, IconChevronDown, IconClose, IconPlus, IconTodo } from "@/components/icons";
import { Button, EmptyState, ErrorState, Field, Sheet, SkeletonList, inputClass } from "@/components/ui";
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
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
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
    if (report(r, "지우지 못했어요. 다시 시도해 주세요")) toast.show(`완료한 ${r.data?.count ?? 0}개를 지웠어요`);
  }

  async function deleteList() {
    if (!list) return;
    const r = await editor.deleteList();
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
      <div>
        <ScreenHeader title="할 일" fallbackHref={todosHref()} backLabel="할 일 목록으로" />
        <EmptyState icon={<IconTodo size={20} />} title="이미 삭제된 목록이에요" className="mt-3 py-6">
          <Link href={todosHref()} className="font-bold text-btn">
            할 일 목록으로
          </Link>
        </EmptyState>
      </div>
    );
  }

  const doneCount = split?.done.length ?? 0;
  const left = split ? (split.open.length > 0 ? `남은 ${split.open.length}개` : doneCount > 0 ? "다 했어요" : "아직 항목이 없어요") : undefined;

  const addRow = list && (
    <li className={split && split.open.length > 0 ? "border-t border-line" : ""}>
      {/* 포커스 테두리는 입력칸만이 아니라 줄 전체에 (입력칸이 줄 끝까지 닿지 않아 반쪽 테두리가 됐다) */}
      <form
        onSubmit={addItem}
        className="flex min-h-11 items-center gap-1 rounded-sm has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-ink has-[input:focus-visible]:outline-solid"
      >
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center text-ink-2">
          <IconPlus size={18} strokeWidth={2.2} />
        </span>
        <label htmlFor="todo-new" className="sr-only">
          항목 추가
        </label>
        <input
          id="todo-new"
          ref={inputRef}
          data-quiet-focus=""
          className="min-h-11 min-w-0 flex-1 bg-transparent py-2.5 text-[15px] leading-5 text-ink outline-none placeholder:text-ink-2 disabled:opacity-60"
          value={draft}
          maxLength={TODO_ITEM_TEXT_MAX}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={full ? `항목은 ${TODO_ITEM_LIMIT}개까지 넣을 수 있어요` : "항목 추가"}
          disabled={full}
          enterKeyHint="enter"
          autoComplete="off"
        />
        {draft.trim().length > 0 && (
          <Button type="submit" size="sm" disabled={full} aria-label="항목 추가" className="mr-1 shrink-0">
            추가
          </Button>
        )}
      </form>
    </li>
  );

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader
        title={list?.name ?? ""}
        fallbackHref={todosHref()}
        backLabel="할 일 목록으로"
        subtitle={left}
        right={
          <OverflowMenu
            label="목록 메뉴"
            disabled={!list}
            items={[
              {
                label: "이름 바꾸기",
                onSelect: () => {
                  setNewName(list?.name ?? "");
                  setRenameError(null);
                  setRenameOpen(true);
                },
              },
              {
                label: doneCount > 0 ? `완료 항목 지우기 (${doneCount})` : "완료 항목 지우기",
                disabled: doneCount === 0,
                destructive: true,
                confirm: { title: `완료한 ${doneCount}개를 지울까요?`, body: "지운 항목은 되돌릴 수 없어요", confirmLabel: "지우기" },
                onSelect: clearDone,
              },
              {
                label: "목록 지우기",
                destructive: true,
                confirm: {
                  title: list ? deleteListPrompt(list.name, items?.length ?? 0) : "목록을 지울까요?",
                  body: "팀원 모두에게서 사라지고 되돌릴 수 없어요",
                  confirmLabel: "삭제",
                },
                onSelect: deleteList,
              },
            ]}
          />
        }
      />

      <div className="mt-3 flex-1">
        {editor.error ? (
          <ErrorState message={messageOf(editor.error, "할 일을 불러오지 못했어요")} onRetry={editor.refetch} />
        ) : split === null || list === null ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            {/* 남은 항목 + 맨 아래 줄 "항목 추가" 를 카드 한 장에 (예전엔 입력칸이 화면 아래에 떨어져 있었다) */}
            <ul className="rounded-xl bg-paper px-1.5 py-1" aria-label="남은 할 일">
              {split.open.map((item, i) => (
                <TodoRow key={item.id} item={item} listName={list.name} first={i === 0} editor={editor} onRemove={removeItem} onFail={(r, f) => report(r, f)} />
              ))}
              {addRow}
            </ul>

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
                      <TodoRow
                        key={item.id}
                        item={item}
                        listName={list.name}
                        first={i === 0}
                        editor={editor}
                        onRemove={removeItem}
                        onFail={(r, f) => report(r, f)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

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
    </div>
  );
}

type Editor = ReturnType<typeof useTodoListEditor>;

/** 밀어서 꺼낸 "삭제" 칸 폭 */
const REVEAL = 76;

/**
 * 항목 한 줄 (높이 44). 글을 누르면 제자리 수정: 엔터 저장, Esc 취소, 빈 글이면 삭제.
 * (#378) 지우기: 터치는 줄을 왼쪽으로 밀어 뒤의 "삭제" 를 꺼내고(76), 줄 폭 절반 넘게 밀면 바로 지운다(되돌리기 토스트).
 * 마우스는 줄에 올리거나 키보드로 ✕ 에 가면 보인다. 스크린 리더와 키보드는 어디서나 "… 삭제" 버튼으로 지운다
 */
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
  const rowRef = useRef<HTMLLIElement>(null);
  // 밀어 낸 거리(0 또는 음수). drag 는 손가락이 닿아 있는 동안만
  const [offset, setOffsetState] = useState(0);
  // 이벤트 사이에 화면을 다시 그리기 전이어도 마지막 값을 읽게 ref 에도 둔다
  const offsetRef = useRef(0);
  const setOffset = (v: number) => {
    offsetRef.current = v;
    setOffsetState(v);
  };
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; base: number; horizontal: boolean | null; moved: boolean } | null>(null);
  // 밀고 난 직후의 click(체크, 고치기)은 막는다
  const swiped = useRef(false);
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

  function onPointerDown(e: React.PointerEvent) {
    // 손가락(펜)만. 마우스 끌기는 글 선택 그대로
    if (e.pointerType === "mouse" || editing || pending) return;
    drag.current = { x: e.clientX, y: e.clientY, base: offsetRef.current, horizontal: null, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // 세로로 먼저 움직이면 목록 스크롤에 맡긴다
      d.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!d.horizontal) {
        drag.current = null;
        return;
      }
      // 손가락이 줄 밖으로 나가도 이 줄이 받게. 이미 끝난 포인터면 던지므로 무시한다
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
      setDragging(true);
    }
    d.moved = true;
    const width = rowRef.current?.offsetWidth || 320;
    setOffset(Math.max(-width, Math.min(0, d.base + dx)));
  }
  function onPointerEnd() {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    setDragging(false);
    swiped.current = true;
    window.setTimeout(() => (swiped.current = false), 0);
    const width = rowRef.current?.offsetWidth || 320;
    const moved = -offsetRef.current;
    if (moved > width * 0.5) {
      setOffset(-width);
      onRemove(item);
      return;
    }
    setOffset(moved > REVEAL / 2 ? -REVEAL : 0);
  }

  return (
    <li ref={rowRef} className={`group relative overflow-hidden ${first ? "" : "border-t border-line"}`}>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          // 밀던 손을 뗀 click, 또는 꺼내 둔 "삭제" 를 닫는 탭은 줄 안 버튼으로 보내지 않는다
          if (swiped.current || offsetRef.current !== 0) {
            e.preventDefault();
            e.stopPropagation();
            if (!swiped.current) setOffset(0);
          }
        }}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        className={`relative z-10 flex min-h-11 touch-pan-y items-center gap-1 bg-paper ${dragging ? "" : "transition-transform duration-200 ease-out"}`}
      >
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
            className="min-w-0 flex-1 py-2.5 pr-2 text-left"
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
        {/* 마우스: 줄에 올리거나 키보드로 오면 보이는 ✕ (터치 기기에서는 숨기고 아래 밀어 낸 "삭제" 를 쓴다) */}
        <button
          type="button"
          disabled={pending}
          onClick={() => onRemove(item)}
          aria-label={`${item.text} 삭제`}
          className="grid size-11 shrink-0 place-items-center rounded-sm text-ink-2 opacity-0 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-0 pointer-coarse:hidden"
        >
          <IconClose size={16} />
        </button>
      </div>
      {/* 터치: 줄 뒤에 숨은 "삭제". 왼쪽으로 밀면 보인다. 키보드로 오면 줄을 밀어 보여 준다 */}
      <button
        type="button"
        disabled={pending}
        aria-label={`${item.text} 삭제`}
        onFocus={() => setOffset(-REVEAL)}
        onClick={() => onRemove(item)}
        className="absolute inset-y-0 right-0 hidden w-[76px] items-center justify-center bg-danger text-[14px] font-bold text-on-btn pointer-coarse:flex"
      >
        삭제
      </button>
    </li>
  );
}
