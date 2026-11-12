/** (#276, D-204) 항목 순서: 미완료는 추가순(createdAt 오름차순, 같으면 id), 그 아래 완료는 완료 시각 최신순(같으면 id 내림차순) */
export interface TodoOrderable {
  id: number;
  done: boolean;
  doneAt: Date | null;
  createdAt: Date;
}

export function sortTodoItems<T extends TodoOrderable>(items: readonly T[]): T[] {
  const open = items.filter((i) => !i.done).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  const done = items
    .filter((i) => i.done)
    .sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0) || b.id - a.id);
  return [...open, ...done];
}
