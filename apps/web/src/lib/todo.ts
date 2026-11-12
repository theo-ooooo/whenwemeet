// (#276) 할 일 목록 규칙. React 를 import 하지 않는다 (단위 테스트 대상)
// 순서와 개수는 API 와 같은 규칙(api.md 2.11, D-204): 미완료는 추가순, 그 아래 완료는 완료 시각 최신순
import { dateKeyOf, parseKey } from "./date";
import type { TodoItem, TodoListSummary } from "./types";

/** 상한 (D-205). 서버가 최종 판단하고 화면은 미리 막는 데만 쓴다 */
export const TODO_LIST_LIMIT = 20;
export const TODO_ITEM_LIMIT = 300;
export const TODO_LIST_NAME_MAX = 30;
export const TODO_ITEM_TEXT_MAX = 100;

/** 빈 목록 화면의 제안 칩 (누르면 그 이름으로 목록을 만든다) */
export const TODO_SUGGESTIONS = ["장보기", "여행 준비물", "같이 할 일"] as const;

const ms = (iso: string | null) => (iso ? Date.parse(iso) : 0);

export function sortTodoItems<T extends Pick<TodoItem, "id" | "done" | "doneAt" | "createdAt">>(items: readonly T[]): T[] {
  const open = items.filter((i) => !i.done).sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.id - b.id);
  const done = items.filter((i) => i.done).sort((a, b) => ms(b.doneAt) - ms(a.doneAt) || b.id - a.id);
  return [...open, ...done];
}

/** 미완료, 완료로 나눈다 (정렬 포함) */
export function splitTodoItems<T extends Pick<TodoItem, "id" | "done" | "doneAt" | "createdAt">>(items: readonly T[]): { open: T[]; done: T[] } {
  const sorted = sortTodoItems(items);
  return { open: sorted.filter((i) => !i.done), done: sorted.filter((i) => i.done) };
}

/** 카드 아래 줄: "남은 3개", 다 했으면 "다 했어요", 비었으면 "아직 비어 있어요" */
export function remainingLabel(list: Pick<TodoListSummary, "openCount" | "doneCount">): string {
  if (list.openCount > 0) return `남은 ${list.openCount}개`;
  return list.doneCount > 0 ? "다 했어요" : "아직 비어 있어요";
}

/** 목록 화면을 updatedAt 내림차순으로 (낙관적으로 바꾼 뒤 다시 줄 세울 때) */
export function sortTodoLists<T extends Pick<TodoListSummary, "id" | "updatedAt">>(lists: readonly T[]): T[] {
  return [...lists].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt) || b.id - a.id);
}

/** 항목 체크 버튼의 스크린 리더 이름 "장보기, 우유, 완료 안 됨" */
export function todoItemLabel(listName: string, item: Pick<TodoItem, "text" | "done">): string {
  return `${listName}, ${item.text}, ${item.done ? "완료됨" : "완료 안 됨"}`;
}

/** 완료 항목 아래 줄 "민지님이 완료, 11월 12일" (KST). 올해가 아니면 연도 */
export function doneByLabel(item: Pick<TodoItem, "doneAt" | "doneBy">, now: number = Date.now()): string | null {
  if (!item.doneAt) return null;
  const key = dateKeyOf(item.doneAt);
  const { y, m, d } = parseKey(key);
  const day = y === parseKey(dateKeyOf(new Date(now).toISOString())).y ? `${m}월 ${d}일` : `${y}년 ${m}월 ${d}일`;
  return item.doneBy ? `${item.doneBy.displayName}님이 완료, ${day}` : `완료, ${day}`;
}

/** 체크를 바꾼 항목 (낙관적 반영). 완료면 시각과 사람을 채운다 */
export function toggledItem<T extends TodoItem>(item: T, done: boolean, me: TodoItem["doneBy"], now: string): T {
  return done ? { ...item, done: true, doneAt: now, doneBy: me } : { ...item, done: false, doneAt: null, doneBy: null };
}

/** 목록 삭제 확인 문구 "장보기와 항목 12개를 지울까요?" (항목이 없으면 "장보기를 지울까요?") */
export function deleteListPrompt(name: string, count: number): string {
  return count > 0 ? `${name}${josaWa(name)} 항목 ${count}개를 지울까요?` : `${name}${josaRul(name)} 지울까요?`;
}

/** 받침 있으면 "과", 없으면 "와" (한글이 아니면 "와") */
function josaWa(word: string): string {
  return hasBatchim(word) ? "과" : "와";
}

function josaRul(word: string): string {
  return hasBatchim(word) ? "을" : "를";
}

function hasBatchim(word: string): boolean {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}
