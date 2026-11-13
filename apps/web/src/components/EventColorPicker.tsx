"use client";
// (#343) 일정 폼의 "색" 줄 (D-215, 디자인규칙 2-2 일정 작성). 첫 칸 "자동"(참여자 색) + 팔레트 8색.
// 라디오 묶음: 고른 칸만 Tab 으로 들어오고 화살표, Home, End 로 옮기며 고른다. 자유 색 선택기는 없다
import { useId, useRef } from "react";
import { IconCheck } from "@/components/icons";
import { COLOR_NAMES, eventColorName, memberColor, ON_MEMBER_COLOR, PICKABLE_COLORS, sameEventColor } from "@/lib/colors";

type Props = {
  /** null = 자동 */
  value: string | null;
  onChange: (v: string | null) => void;
  /** 자동 칸에 보여 줄 지금 참여자 색 (화면 색, 최대 3) */
  autoColors: readonly string[];
  /** 반복 일정 "이 일정만" 수정: 바꿀 수 없다 */
  disabled?: boolean;
  /** 막혀 있을 때 아래 안내 한 줄 */
  note?: string;
  /** (#378) 카드와 "색 ··· 값" 머리 없이 칸 묶음만 (일정 폼의 색 시트 안) */
  bare?: boolean;
  /** (#378) 누르거나 Enter, Space 로 고른 뒤 (방향키로 옮길 때는 부르지 않는다). 시트를 닫는 데 쓴다 */
  onPicked?: () => void;
};

const OPTIONS: (string | null)[] = [null, ...PICKABLE_COLORS];

export function EventColorPicker({ value, onChange, autoColors, disabled = false, note, bare = false, onPicked }: Props) {
  const labelId = useId();
  const noteId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    OPTIONS.findIndex((o) => sameEventColor(o, value)),
  );

  function move(to: number) {
    const i = (to + OPTIONS.length) % OPTIONS.length;
    onChange(OPTIONS[i]);
    refs.current[i]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: OPTIONS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    move(next);
  }

  return (
    <div className={bare ? "" : "rounded-xl bg-paper px-3.5 py-3"}>
      {!bare && (
        <div className="flex min-h-6 items-center gap-3">
          <span id={labelId} className="shrink-0 text-[14px] font-semibold">
            색
          </span>
          <span className="ml-auto min-w-0 truncate text-[14px] text-ink-2">{eventColorName(value)}</span>
        </div>
      )}
      <div
        role="radiogroup"
        aria-labelledby={bare ? undefined : labelId}
        aria-label={bare ? "색" : undefined}
        aria-describedby={note ? noteId : undefined}
        aria-disabled={disabled || undefined}
        className={`${bare ? "py-1" : "mt-2.5"} flex flex-wrap items-center gap-x-3 gap-y-2.5 ${disabled ? "opacity-45" : ""}`}
      >
        {OPTIONS.map((c, i) => {
          const selected = i === selectedIndex;
          const common = {
            ref: (el: HTMLButtonElement | null) => {
              refs.current[i] = el;
            },
            type: "button" as const,
            role: "radio",
            "aria-checked": selected,
            tabIndex: selected ? 0 : -1,
            disabled,
            onClick: () => {
              onChange(c);
              onPicked?.();
            },
            onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => onKeyDown(e, i),
          };
          if (c === null) {
            // 자동: 글자 알약 + 지금 참여자 색 점 (최대 3)
            return (
              <button
                key="auto"
                {...common}
                aria-label="자동, 참여자 색"
                className={`anim-pick hit flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap disabled:cursor-not-allowed ${
                  selected ? "border-transparent bg-surface font-bold text-ink" : "border-line bg-paper font-medium text-soft hover:text-ink"
                }`}
                // 고른 칸은 색 칸과 같은 두 겹 테두리 (먹색)
                style={{ boxShadow: selected ? "0 0 0 2px var(--tile), 0 0 0 4px var(--ink)" : undefined }}
              >
                자동
                <span aria-hidden="true" className="inline-flex items-center gap-0.5">
                  {(autoColors.length ? autoColors : ["var(--mute)"]).slice(0, 3).map((dot, k) => (
                    <i key={k} className="block size-1.5 rounded-full" style={{ background: dot }} />
                  ))}
                </span>
              </button>
            );
          }
          const shown = memberColor(c);
          return (
            <button
              key={c}
              {...common}
              aria-label={COLOR_NAMES[i - 1]}
              className="hit flex size-8 items-center justify-center rounded-full disabled:cursor-not-allowed"
              style={{ backgroundColor: shown, boxShadow: selected ? `0 0 0 2px var(--tile), 0 0 0 4px ${shown}` : undefined }}
            >
              {selected && <IconCheck size={16} strokeWidth={2.6} style={{ color: ON_MEMBER_COLOR }} />}
            </button>
          );
        })}
      </div>
      {note && (
        <p id={noteId} className="t-sub mt-2.5">
          {note}
        </p>
      )}
    </div>
  );
}
