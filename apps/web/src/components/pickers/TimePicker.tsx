"use client";
// 시각 피커 (#67). 브라우저 기본 input[type=time] / select 대신 쓴다.
// 30분 단위 목록(열면 현재 값이 가운데) + 위 칸에서 직접 입력(HH:mm, 1430, 9:05 등).
// 표기는 "오후 2:30" 과 24시간 "14:30" 을 같이. allow24 면 마지막에 24:00(자정) 을 둔다 (빈 시간 찾기 종료, #58).
// 키보드: 목록에서 위/아래 이동, Home/End, Enter 선택, Esc 닫기. 입력 칸에서 Enter 로 적용, 아래 방향키로 목록 진입
// 펼침 모드: onInlineToggle 을 주면 팝오버를 띄우지 않고 버튼만 그린다. 목록(TimeList)은 부모가 원하는 자리에 펼친다
// (빠른 추가 팝오버 안에서 팝오버가 또 겹치지 않게)
import { useEffect, useId, useRef, useState } from "react";
import { PickerShell, triggerClass } from "./PickerShell";
import { formatTimeKo, minutesOf, parseTimeInput, timeOfMinutes } from "./time";

type Props = {
  value: string;
  onChange: (v: string) => void;
  label: string;
  id?: string;
  /** 목록 첫 값(분). 기본 0 */
  from?: number;
  /** 목록 마지막 값(분). 기본 23:30, allow24 면 24:00 */
  to?: number;
  /** 24:00 을 고를 수 있게 한다 */
  allow24?: boolean;
  step?: number;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /** 펼침 모드에서 목록이 열려 있는지 */
  inlineOpen?: boolean;
  /** 주면 펼침 모드. 버튼을 누르면 이걸 부르고 팝오버는 띄우지 않는다 */
  onInlineToggle?: () => void;
};

export function TimePicker({
  value,
  onChange,
  label,
  id,
  from = 0,
  to,
  allow24 = false,
  step = 30,
  className = "",
  inlineOpen = false,
  onInlineToggle,
  ...rest
}: Props) {
  const [popOpen, setPopOpen] = useState(false);
  const inline = Boolean(onInlineToggle);
  const open = inline ? inlineOpen : popOpen;
  const setOpen = setPopOpen;
  const btn = useRef<HTMLButtonElement>(null);
  const last = to ?? (allow24 ? 24 * 60 : 24 * 60 - step);
  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        aria-haspopup={inline ? "listbox" : "dialog"}
        aria-expanded={open}
        aria-label={`${label}, ${value ? formatTimeKo(value) : "선택 안 함"}`}
        aria-describedby={rest["aria-describedby"]}
        onClick={() => (onInlineToggle ? onInlineToggle() : setOpen((v) => !v))}
        className={`${triggerClass} ${rest["aria-invalid"] ? "outline-2 outline-danger" : ""} ${open && inline ? "outline-2 outline-ink" : ""} ${className}`}
      >
        <span className="truncate">{value ? formatTimeKo(value) : "시각 선택"}</span>
        {value && <span className="shrink-0 text-[12px] text-ink-2">{value}</span>}
      </button>
      {!inline && (
      <PickerShell open={open} onClose={() => setOpen(false)} trigger={btn} title={label} width={248}>
        <TimeList
          value={value}
          from={from}
          to={last}
          step={step}
          allow24={allow24}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </PickerShell>
      )}
    </>
  );
}

export function TimeList({
  value,
  from = 0,
  to: toProp,
  step = 30,
  allow24 = false,
  onPick,
  onClose,
  listClassName = "max-h-[264px]",
}: {
  value: string;
  from?: number;
  to?: number;
  step?: number;
  allow24?: boolean;
  onPick: (v: string) => void;
  /** 펼침 모드에서 Esc 로 닫기. 주면 Esc 가 바깥(팝오버)까지 닫지 않게 막는다 */
  onClose?: () => void;
  listClassName?: string;
}) {
  const to = toProp ?? (allow24 ? 24 * 60 : 24 * 60 - step);
  const options: string[] = [];
  for (let m = from; m <= to; m += step) options.push(timeOfMinutes(m));
  const cur = minutesOf(value);
  // 목록에 없는 값(예: 10:05) 이면 가장 가까운 앞 칸을 기준으로 둔다
  const initial = Math.max(
    0,
    options.reduce((best, o, i) => (cur !== null && minutesOf(o)! <= cur ? i : best), 0),
  );
  const [active, setActive] = useState(initial);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const ids = useId();

  // 열 때 현재 값을 목록 가운데로, 포커스는 목록에
  useEffect(() => {
    const ul = list.current;
    const el = ul?.querySelector<HTMLElement>(`[data-i="${initial}"]`);
    if (ul && el) ul.scrollTop = el.offsetTop - ul.clientHeight / 2 + el.offsetHeight / 2;
    list.current?.focus({ preventScroll: true });
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ul = list.current;
    const el = ul?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!ul || !el) return;
    if (el.offsetTop < ul.scrollTop) ul.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = el.offsetTop + el.offsetHeight - ul.clientHeight;
  }, [active]);

  function applyDraft() {
    const t = parseTimeInput(draft, allow24);
    if (!t) {
      setError(allow24 ? "00:00~24:00 사이로 입력해 주세요" : "00:00~23:59 사이로 입력해 주세요");
      return;
    }
    const m = minutesOf(t)!;
    if (m < from || m > to) {
      setError(`${timeOfMinutes(from)}~${timeOfMinutes(to)} 사이로 입력해 주세요`);
      return;
    }
    onPick(t);
  }

  function onListKey(e: React.KeyboardEvent) {
    const n = options.length;
    if (e.key === "ArrowDown") setActive((a) => Math.min(n - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "PageDown") setActive((a) => Math.min(n - 1, a + 4));
    else if (e.key === "PageUp") setActive((a) => Math.max(0, a - 4));
    else if (e.key === "Enter" || e.key === " ") onPick(options[active]);
    else if (e.key === "Escape" && onClose) {
      e.stopPropagation();
      onClose();
    } else return;
    e.preventDefault();
  }

  return (
    <div>
      <label htmlFor={`${ids}-in`} className="mb-1 block px-1 text-[12px] font-medium text-ink-2">
        직접 입력
      </label>
      <div className="flex gap-1.5">
        <input
          id={`${ids}-in`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="HH:mm"
          value={draft}
          maxLength={5}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyDraft();
            } else if (e.key === "Escape" && onClose) {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              list.current?.focus();
            }
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${ids}-err` : undefined}
          className="h-9 min-w-0 flex-1 rounded-sm bg-surface px-3 text-[14px] tabular-nums focus:outline-2 focus:outline-ink"
        />
        <button type="button" onClick={applyDraft} className="h-9 shrink-0 rounded-sm bg-btn px-3 text-[13px] font-bold text-on-btn hover:brightness-95">
          적용
        </button>
      </div>
      {error && (
        <p id={`${ids}-err`} role="alert" className="mt-1 px-1 text-[12px] text-danger">
          {error}
        </p>
      )}
      <ul
        ref={list}
        role="listbox"
        tabIndex={0}
        aria-label="30분 단위 시각"
        aria-activedescendant={`${ids}-o${active}`}
        onKeyDown={onListKey}
        className={`relative mt-2 ${listClassName} overflow-y-auto rounded-sm py-1 outline-none focus-visible:outline-2 focus-visible:outline-ink`}
      >
        {options.map((o, i) => {
          const selected = o === value;
          const isActive = i === active;
          return (
            <li
              key={o}
              id={`${ids}-o${i}`}
              data-i={i}
              role="option"
              aria-selected={selected}
              onClick={() => onPick(o)}
              onPointerMove={() => setActive(i)}
              className={`anim-pick flex h-10 cursor-pointer items-center justify-between rounded-sm px-3 text-[14px] tabular-nums ${
                selected ? "font-bold text-acc-ink" : isActive ? "bg-hover" : ""
              } ${isActive ? "ring-2 ring-inset ring-ink/15" : ""}`}
            >
              <span>{formatTimeKo(o)}</span>
              <span className={`text-[12px] ${selected ? "" : "text-ink-2"}`}>{o}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
