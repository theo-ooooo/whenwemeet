"use client";
// 이름 바꾸기 한 가지 모양 (#171): 닉네임(내 정보), 팀 이름, 이 팀에서 표시 이름(팀 설정)
// 값 행(라벨 12 + 값 15/600 + 오른쪽 32 '바꾸기') → 같은 자리에서 입력 44 + 오른쪽 44 '저장'.
// 글자 수는 입력 칸 안 오른쪽, 오류는 아래 한 줄. 취소는 Esc 또는 바깥 탭. 행 높이(44)는 편집 전후 같다
import { useEffect, useId, useRef, useState } from "react";
import { Button, inputClass } from "./ui";
import { charCount, clampChars } from "@/lib/chars";
import { nameProblem } from "@/lib/text";

export function NameEditRow({
  label,
  value,
  max,
  allowEmpty = false,
  placeholder,
  saving,
  onSave,
  autoComplete,
}: {
  label: string;
  /** 지금 값 (보기 행에 표시, 편집 시작 값) */
  value: string;
  max: number;
  /** 비워도 되는 칸 (표시 이름: 비우면 닉네임) */
  allowEmpty?: boolean;
  placeholder?: string;
  saving: boolean;
  /** 저장. 실패하면 보여 줄 문구, 성공하면 null */
  onSave: (next: string) => Promise<string | null>;
  autoComplete?: string;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const count = charCount(draft.trim());

  function start() {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  // 바깥 탭으로 취소 (저장 중에는 그대로)
  useEffect(() => {
    if (!editing || saving) return;
    const onDown = (e: PointerEvent) => {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        setEditing(false);
        setError(null);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [editing, saving]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = nameProblem(label, draft, max, allowEmpty);
    if (problem) {
      setError(problem);
      return;
    }
    const next = draft.trim();
    if (next === value) {
      setEditing(false);
      return;
    }
    const failed = await onSave(next);
    if (failed) {
      setError(failed);
      return;
    }
    setEditing(false);
  }

  return (
    <div>
      <label htmlFor={editing ? id : undefined} className="mb-1 block text-[12px] font-medium leading-4 text-ink-2">
        {label}
      </label>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              id={id}
              className={`${inputClass} pr-14`}
              value={draft}
              placeholder={placeholder}
              onChange={(e) => {
                setDraft(clampChars(e.target.value, max));
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditing(false);
                  setError(null);
                }
              }}
              autoComplete={autoComplete ?? "off"}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-count${error ? ` ${id}-err` : ""}`}
            />
            <span
              id={`${id}-count`}
              className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] tabular-nums ${count > max ? "text-danger" : "text-ink-2"}`}
            >
              {count}/{max}
            </span>
          </div>
          <Button type="submit" loading={saving}>
            저장
          </Button>
        </form>
      ) : (
        <div className="flex min-h-11 items-center gap-3">
          <p className={`line-clamp-2 min-w-0 flex-1 break-all text-[15px] font-semibold leading-5 ${value ? "" : "text-ink-2"}`}>
            {value || placeholder}
          </p>
          <Button variant="secondary" size="sm" onClick={start} aria-label={`${label} 바꾸기`}>
            바꾸기
          </Button>
        </div>
      )}
      {editing && error && (
        <p id={`${id}-err`} role="alert" className="mt-1.5 text-[12px] leading-4 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
