// (#276) 할 일 목록 규칙: 정렬, 남은 개수, 문구
import { describe, expect, it } from "vitest";
import { deleteListPrompt, doneByLabel, remainingLabel, sortTodoItems, sortTodoLists, splitTodoItems, todoItemLabel, toggledItem } from "../todo";
import type { Member, TodoItem } from "../types";

const minji: Member = { userId: 2, displayName: "민지", color: "#5B6CF4", profileImageUrl: null };
const item = (over: Partial<TodoItem>): TodoItem => ({
  id: 1,
  listId: 7,
  text: "우유",
  done: false,
  doneAt: null,
  doneBy: null,
  creator: minji,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

describe("sortTodoItems", () => {
  it("미완료 추가순(같으면 id), 그 아래 완료 최신순 (API 와 같은 규칙)", () => {
    const rows = [
      item({ id: 1, done: true, doneAt: "2026-11-03T00:00:00.000Z" }),
      item({ id: 2, createdAt: "2026-11-02T00:00:00.000Z" }),
      item({ id: 3 }),
      item({ id: 4, done: true, doneAt: "2026-11-05T00:00:00.000Z" }),
      item({ id: 5 }),
    ];
    expect(sortTodoItems(rows).map((r) => r.id)).toEqual([3, 5, 2, 4, 1]);
    const { open, done } = splitTodoItems(rows);
    expect(open.map((r) => r.id)).toEqual([3, 5, 2]);
    expect(done.map((r) => r.id)).toEqual([4, 1]);
  });
});

describe("remainingLabel", () => {
  it("남은 개수, 다 했으면 '다 했어요', 비면 안내", () => {
    expect(remainingLabel({ openCount: 3, doneCount: 1 })).toBe("남은 3개");
    expect(remainingLabel({ openCount: 0, doneCount: 2 })).toBe("다 했어요");
    expect(remainingLabel({ openCount: 0, doneCount: 0 })).toBe("아직 비어 있어요");
  });
});

describe("sortTodoLists", () => {
  it("updatedAt 내림차순, 같으면 id 내림차순", () => {
    const lists = [
      { id: 1, updatedAt: "2026-11-01T00:00:00.000Z" },
      { id: 2, updatedAt: "2026-11-03T00:00:00.000Z" },
      { id: 3, updatedAt: "2026-11-01T00:00:00.000Z" },
    ];
    expect(sortTodoLists(lists).map((l) => l.id)).toEqual([2, 3, 1]);
  });
});

describe("문구", () => {
  it("체크 버튼 이름", () => {
    expect(todoItemLabel("장보기", { text: "우유", done: false })).toBe("장보기, 우유, 완료 안 됨");
    expect(todoItemLabel("장보기", { text: "우유", done: true })).toBe("장보기, 우유, 완료됨");
  });

  it("완료한 사람과 날짜 (KST, 올해가 아니면 연도)", () => {
    const now = Date.parse("2026-11-12T03:00:00.000Z");
    // UTC 11일 16:00 = KST 12일 01:00
    expect(doneByLabel({ doneAt: "2026-11-11T16:00:00.000Z", doneBy: minji }, now)).toBe("민지님이 완료, 11월 12일");
    expect(doneByLabel({ doneAt: "2025-12-31T00:00:00.000Z", doneBy: null }, now)).toBe("완료, 2025년 12월 31일");
    expect(doneByLabel({ doneAt: null, doneBy: null }, now)).toBeNull();
  });

  it("목록 삭제 확인 (받침에 따라 와/과, 을/를)", () => {
    expect(deleteListPrompt("장보기", 12)).toBe("장보기와 항목 12개를 지울까요?");
    expect(deleteListPrompt("여행 준비물", 3)).toBe("여행 준비물과 항목 3개를 지울까요?");
    expect(deleteListPrompt("장보기", 0)).toBe("장보기를 지울까요?");
    expect(deleteListPrompt("같이 할 일", 0)).toBe("같이 할 일을 지울까요?");
    expect(deleteListPrompt("Shopping", 1)).toBe("Shopping와 항목 1개를 지울까요?");
  });

  it("체크 토글 (낙관적 반영)", () => {
    const now = "2026-11-12T03:00:00.000Z";
    expect(toggledItem(item({}), true, minji, now)).toMatchObject({ done: true, doneAt: now, doneBy: minji });
    expect(toggledItem(item({ done: true, doneAt: now, doneBy: minji }), false, minji, now)).toMatchObject({ done: false, doneAt: null, doneBy: null });
  });
});
