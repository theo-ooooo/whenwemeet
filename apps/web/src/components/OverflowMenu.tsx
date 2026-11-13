"use client";
// (#378) 머리줄 오른쪽 "⋯" 메뉴. 디자인규칙.md 8-2.
// - ⋯ 버튼(44×44) 아래 오른쪽 끝에 붙는 작은 팝오버(흰 면, 모서리 12, 팝오버 그림자, 최소 폭 180). 폰도 같은 팝오버(시안 그대로)
// - 항목은 role=menuitem. 열면 첫 항목에 포커스, ↑ ↓ Home End 로 옮기고, Esc 는 닫고 ⋯ 로 포커스를 돌린다. Tab 은 닫고 다음으로 넘어간다
// - 바깥을 누르면 닫는다
// - destructive 항목(지우기, 나가기)은 `--danger` 글자. 고르면 바로 실행하지 않고 확인 창(ConfirmDialog, 빨간 확인 버튼)을 먼저 띄운다.
//   onSelect 가 Promise 를 돌려주면 끝날 때까지 확인 버튼이 도는 상태로 기다렸다 닫는다. 일정 삭제의 되돌리기(#375)는 부르는 쪽 몫
import { useEffect, useId, useRef, useState } from "react";
import { IconMore } from "./icons";
import { ConfirmDialog } from "./ui";

type Confirm = {
  title: string;
  body?: string;
  confirmLabel: string;
};

type ItemBase = {
  label: string;
  /** 왼쪽 선 아이콘 18 (선택) */
  icon?: React.ReactNode;
  disabled?: boolean;
  onSelect: () => void | Promise<unknown>;
};

export type OverflowMenuItem =
  | (ItemBase & { destructive?: false; confirm?: undefined })
  | (ItemBase & {
      destructive: true;
      /** 확인 창 문구. 지우기처럼 되돌리기 어려운 항목은 반드시 준다 */
      confirm: Confirm;
    });

const ENABLED_ITEM = '[role="menuitem"]:not([disabled])';

type Props = {
  /** ⋯ 버튼 읽기 이름 (예: "일정 메뉴") */
  label: string;
  items: OverflowMenuItem[];
  disabled?: boolean;
};

export function OverflowMenu({ label, items, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<OverflowMenuItem | null>(null);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 열 때 처음 포커스할 항목: 0 = 첫, -1 = 마지막
  const focusAt = useRef(0);
  const menuId = useId();
  const buttonId = useId();

  const enabledItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ENABLED_ITEM) ?? []);

  useEffect(() => {
    if (!open) return;
    const list = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ENABLED_ITEM) ?? []);
    (focusAt.current < 0 ? list[list.length - 1] : list[0])?.focus();
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const openAt = (at: 0 | -1) => {
    focusAt.current = at;
    setOpen(true);
  };

  const choose = (item: OverflowMenuItem) => {
    if (item.disabled) return;
    if (item.destructive) {
      // 메뉴는 닫고 확인 창. 확인 창이 닫히면 ⋯ 로 포커스를 돌린다
      setOpen(false);
      setPending(item);
      return;
    }
    close();
    void item.onSelect();
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.onSelect();
    } finally {
      setBusy(false);
      setPending(null);
      buttonRef.current?.focus();
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = enabledItems();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") close(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openAt(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            openAt(0);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openAt(-1);
          }
        }}
        className="grid size-11 place-items-center rounded-sm text-ink hover:bg-hover disabled:text-ink-2"
      >
        <IconMore size={22} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={buttonId}
          onKeyDown={onMenuKey}
          className="anim-fade absolute right-0 top-full z-40 mt-1 min-w-[180px] overflow-hidden rounded-md border border-line bg-paper py-1 shadow-[var(--pop-shadow)]"
        >
          {items.map((item, i) => (
            <button
              key={`${i}-${item.label}`}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => choose(item)}
              className={`flex min-h-11 w-full items-center gap-2.5 px-3.5 text-left text-[14px] font-semibold whitespace-nowrap hover:bg-hover focus-visible:bg-hover focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${
                item.destructive ? "text-danger" : "text-ink"
              }`}
            >
              {item.icon && (
                <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center ${item.destructive ? "" : "text-ink-2"}`}>
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.confirm?.title ?? ""}
        body={pending?.confirm?.body}
        confirmLabel={pending?.confirm?.confirmLabel ?? ""}
        danger
        loading={busy}
        onConfirm={() => void confirmPending()}
        onCancel={() => {
          if (busy) return;
          setPending(null);
          buttonRef.current?.focus();
        }}
      />
    </div>
  );
}
