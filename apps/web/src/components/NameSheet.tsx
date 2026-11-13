"use client";
// (#378) 이름 바꾸기 한 가지 모양: 닉네임(내 정보), 팀 이름, 이 팀에서 표시 이름(팀 설정).
// 예전(#171)에는 값 옆 "바꾸기" 버튼 → 같은 자리 입력이었다. 이제 설정 줄("팀 이름 ··· 우리 둘 ›")을 누르면 시트가 뜨고
// 이름 칸(라벨 없이 맨 위, 글자 수는 80% 넘을 때만) + 맨 아래 "저장" 한 자리 (디자인규칙.md 8-0 6).
// 오류는 칸 아래 한 줄. 같은 값이면 저장 없이 닫는다
import { useId, useState } from "react";
import { Button, Sheet, inputClass } from "./ui";
import { charCount, clampChars } from "@/lib/chars";
import { nameProblem } from "@/lib/text";

type FormProps = {
  /** 칸 이름 (읽기 이름, 오류 문구) */
  label: string;
  /** 지금 값 (시작 값) */
  value: string;
  max: number;
  /** 비워도 되는 칸 (표시 이름: 비우면 닉네임) */
  allowEmpty?: boolean;
  placeholder?: string;
  saving: boolean;
  /** 저장. 실패하면 보여 줄 문구, 성공하면 null */
  onSave: (next: string) => Promise<string | null>;
  /** 저장했거나 바뀐 것이 없을 때 */
  onDone: () => void;
  autoComplete?: string;
  /** 처음 열 때 칸에 포커스 */
  autoFocus?: boolean;
};

/** 이름 칸 + 저장. 시트 안에 그대로 넣는다 (프로필 시트는 사진 줄 아래에) */
export function NameForm({ label, value, max, allowEmpty = false, placeholder, saving, onSave, onDone, autoComplete, autoFocus = true }: FormProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const count = charCount(draft.trim());
  // 글자 수는 80% 넘을 때만 (입력 화면 규칙 1)
  const showCount = count > max * 0.8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = nameProblem(label, draft, max, allowEmpty);
    if (problem) {
      setError(problem);
      return;
    }
    const next = draft.trim();
    if (next === value) {
      onDone();
      return;
    }
    const failed = await onSave(next);
    if (failed) {
      setError(failed);
      return;
    }
    onDone();
  }

  const describedBy = [showCount ? `${id}-count` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <form onSubmit={submit} noValidate className="space-y-3 pb-1">
      <div>
        <div className="relative">
          <input
            id={id}
            aria-label={label}
            className={`${inputClass} text-[16px] font-semibold ${showCount ? "pr-14" : ""}`}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => {
              setDraft(clampChars(e.target.value, max));
              setError(null);
            }}
            autoComplete={autoComplete ?? "off"}
            autoFocus={autoFocus}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
          {showCount && (
            <span
              id={`${id}-count`}
              className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] tabular-nums ${count > max ? "text-danger" : "text-ink-2"}`}
            >
              {count}/{max}
            </span>
          )}
        </div>
        {error && (
          <p id={`${id}-err`} role="alert" className="mt-1.5 text-[12px] leading-4 text-danger">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" full loading={saving}>
        저장
      </Button>
    </form>
  );
}

/** 이름 하나만 바꾸는 시트. 열 때마다 지금 값에서 다시 시작한다 */
export function NameSheet({ open, title, onClose, ...form }: Omit<FormProps, "onDone"> & { open: boolean; title: string; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open && <NameForm {...form} onDone={onClose} />}
    </Sheet>
  );
}
