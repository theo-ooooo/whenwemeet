"use client";
// (#359) 일정 초안 상태. 값, 연동 규칙은 lib/event-draft.ts, 여기는 useReducer 로 감싸고 처음 값과 비교만 한다.
// 서버를 부르지 않는 폼 상태 훅이다 (useTodoListEditor 와 같은 자리).
import { useCallback, useReducer } from "react";
import { applyDraft, draftChanged, type DraftAction, type DraftSpan, type EventDraft } from "@/lib/event-draft";

type State = {
  draft: EventDraft;
  /** 처음 채운 값. 불러오기 전(수정, 복제)이면 null */
  initial: EventDraft | null;
  /** 저장을 눌렀거나 고친 제목에서 벗어났는지. 빈 제목 오류를 이때부터 보인다 (#80) */
  touched: boolean;
};

type Action = DraftAction | { type: "load"; draft: EventDraft } | { type: "touch" };

function reducer(span: DraftSpan) {
  return (s: State, a: Action): State => {
    if (a.type === "load") return { ...s, draft: a.draft, initial: a.draft };
    if (a.type === "touch") return s.touched ? s : { ...s, touched: true };
    return { ...s, draft: applyDraft(s.draft, a, span) };
  };
}

/**
 * @param first 처음 값. `waitForLoad` 면 불러온 일정을 `load` 로 채울 때까지 처음 값이 없다(loaded=false)
 * @returns dirty: 처음 값과 달라졌는지 (#137 이탈 확인)
 */
export function useEventDraft(span: DraftSpan, first: () => EventDraft, opts: { waitForLoad?: boolean } = {}) {
  const [state, dispatch] = useReducer(reducer(span), undefined, () => {
    const draft = first();
    return { draft, initial: opts.waitForLoad ? null : draft, touched: false };
  });
  const load = useCallback((draft: EventDraft) => dispatch({ type: "load", draft }), []);
  const touch = useCallback(() => dispatch({ type: "touch" }), []);
  const { draft, initial, touched } = state;
  return {
    draft,
    initial,
    touched,
    loaded: initial !== null,
    dirty: initial !== null && draftChanged(draft, initial),
    dispatch: dispatch as React.Dispatch<DraftAction>,
    load,
    touch,
  };
}
