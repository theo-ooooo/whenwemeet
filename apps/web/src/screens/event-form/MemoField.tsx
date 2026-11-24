"use client";
// (#497) 일정 폼 4. 메모. 글자 수는 80% 부터. EventFormScreen 에서 옮김 (높이 맞추기는 useMemoAutoGrow)
import type { RefObject } from "react";
import { charCount, nearLimit } from "@/lib/chars";
import { MEMO_MAX, memoHint, type DraftAction, type EventDraft } from "@/lib/event-draft";

type Props = {
  draft: EventDraft;
  dispatch: React.Dispatch<DraftAction>;
  memoRef: RefObject<HTMLTextAreaElement | null>;
};

export function MemoField({ draft, dispatch, memoRef }: Props) {
  const { memo } = draft;
  const memoNear = nearLimit(charCount(memo), MEMO_MAX);
  return (
    <div className="rounded-lg bg-paper px-3.5 py-2.5">
      <label htmlFor="ev-memo" className="sr-only">
        메모
      </label>
      <textarea
        ref={memoRef}
        id="ev-memo"
        rows={3}
        aria-describedby={memoNear ? "ev-memo-count" : undefined}
        className="-mx-1.5 block max-h-[50dvh] min-h-[72px] w-[calc(100%+12px)] resize-none overflow-y-auto rounded-sm bg-transparent px-1.5 py-1.5 text-[14px] leading-5 text-ink placeholder:text-ink-2 focus:outline-2 focus:outline-ink focus:outline-offset-0"
        placeholder="메모 (준비물, 링크 등)"
        value={memo}
        onChange={(e) => dispatch({ type: "memo", value: e.target.value })}
      />
      {memoNear && (
        <p id="ev-memo-count" className="t-sub pb-0.5 text-right tabular-nums">
          {memoHint(draft)}
        </p>
      )}
    </div>
  );
}
