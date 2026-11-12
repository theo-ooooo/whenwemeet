"use client";
// 반복 일정(#187) 시트 두 개. 모양은 공통 Sheet (ui.tsx) 그대로
//   RepeatSheet: 일정 폼의 "반복" 줄을 누르면 뜨는 목록 (반복 안 함 / 매주 / 격주 / 매월 / 매년)
//   ScopeSheet:  반복 일정 저장, 삭제 때 범위 "이 일정만" / "이후 모두" + 취소. 삭제는 위험 글자 (기획 3-5)
import { IconCheck } from "./icons";
import { Button, Sheet, Spinner } from "./ui";
import { formatDateKo, type DateKey } from "@/lib/date";
import { REPEATS } from "@/lib/recurrence";
import { repeatLabel } from "@/lib/recurrence-label";
import type { EventScope, Repeat } from "@/lib/types";

export function RepeatSheet({
  open,
  value,
  firstDate,
  labelDate,
  onPick,
  onClose,
}: {
  open: boolean;
  value: Repeat | null;
  /** 첫 회차 날짜. 항목마다 "매주 목요일" 처럼 실제 규칙을 보여 준다 */
  firstDate: DateKey;
  /** 주기별 설명 날짜. 반복 일정을 고칠 때 이어받는 기준 날짜(D-71) 를 쓴다. 없으면 firstDate */
  labelDate?: (repeat: Repeat) => DateKey;
  onPick: (v: Repeat | null) => void;
  onClose: () => void;
}) {
  const options: { value: Repeat | null; label: string }[] = [
    { value: null, label: "반복 안 함" },
    ...REPEATS.map((r) => ({ value: r, label: repeatLabel(r, labelDate ? labelDate(r) : firstDate) })),
  ];
  return (
    <Sheet open={open} onClose={onClose} title="반복">
      <ul role="radiogroup" aria-label="반복" className="pb-1">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <li key={o.value ?? "none"}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onPick(o.value)}
                className={`flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] hover:bg-hover ${on ? "font-bold" : "font-medium"}`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {on && <IconCheck size={18} className="shrink-0 text-acc-ink" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

export function ScopeSheet({
  open,
  mode,
  occurrence,
  onlyFollowing = false,
  pending = null,
  onPick,
  onClose,
}: {
  open: boolean;
  mode: "save" | "delete";
  /** 고른 회차의 원래 날짜 */
  occurrence: DateKey;
  /** 반복 규칙, 참여자(#248 D-135), 일정 색(#343 D-215)을 바꿨으면 "이 일정만" 은 고를 수 없다 (모두 이후 모두에서만 바꾼다, 기획 3-4) */
  onlyFollowing?: boolean;
  /** 요청 중인 선택. 그 줄에 스피너, 나머지는 잠근다 */
  pending?: EventScope | null;
  onPick: (scope: EventScope) => void;
  onClose: () => void;
}) {
  const del = mode === "delete";
  const day = formatDateKo(occurrence);
  const rows: { scope: EventScope; label: string; sub: string; disabled?: boolean }[] = [
    {
      scope: "this",
      label: "이 일정만",
      sub: onlyFollowing ? "반복, 참여자, 색을 바꾸면 이 일정만 고칠 수 없어요" : `${day} 일정만 ${del ? "삭제해요" : "바꿔요"}`,
      disabled: onlyFollowing,
    },
    { scope: "following", label: "이후 모두", sub: `${day}부터 반복 일정을 모두 ${del ? "삭제해요" : "바꿔요"}` },
  ];
  const busy = pending !== null;
  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={del ? "반복 일정 삭제" : "반복 일정 저장"}>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.scope}>
            <button
              type="button"
              disabled={r.disabled || busy}
              onClick={() => onPick(r.scope)}
              className="flex min-h-14 w-full items-center gap-3 rounded-md bg-surface px-3.5 py-2.5 text-left hover:brightness-95 disabled:cursor-not-allowed disabled:hover:brightness-100"
            >
              <span className="min-w-0 flex-1">
                <b className={`block text-[15px] font-bold leading-5 ${r.disabled ? "text-ink-2" : del ? "text-danger" : ""}`}>{r.label}</b>
                <span className="mt-0.5 block text-[12px] leading-4 text-ink-2">{r.sub}</span>
              </span>
              {pending === r.scope && <Spinner />}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="lg" full className="mt-3" onClick={onClose} disabled={busy}>
        취소
      </Button>
    </Sheet>
  );
}
