"use client";
import Link from "next/link";
import { useId } from "react";
import { IconChevronRight } from "../icons";
import { SwitchTrack } from "./SwitchTrack";

/* ---------- 줄 버튼 ---------- */

export const rowClass = "flex min-h-11 w-full items-center gap-3 py-1 text-left";

/** 줄 왼쪽 아이콘 칸 (18~20 선 아이콘, `--mute`). 설정 줄 "아이콘 이름 ··· 값 ›" (#378) */
export function RowIcon({ children, className = "text-ink-2" }: { children: React.ReactNode; className?: string }) {
  return (
    <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center ${className}`}>
      {children}
    </span>
  );
}

/**
 * (#359) 카드 안 "이름 ……… 값 ›" 한 줄 (일정 폼의 참여자, 알림, 반복, 빠른 추가의 알림). 누르면 시트나 펼침을 연다.
 * 값이 글자면 value, 모양이 따로 있으면(참여자 아바타) children. 펼침(빠른 추가)은 chevron 없이.
 * (#378) 왼쪽 icon(선 아이콘 18) 을 받으면 "아이콘 이름 ··· 값 ›". "바꾸기" 버튼 대신 이 줄을 누르게 한다
 */
export function RowButton({
  label,
  value,
  icon,
  chevron = true,
  className = "",
  children,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> & { label: string; value?: React.ReactNode; icon?: React.ReactNode; chevron?: boolean }) {
  return (
    <button type="button" className={`${rowClass} disabled:opacity-45 ${className}`} {...rest}>
      {icon && <RowIcon>{icon}</RowIcon>}
      <span className="shrink-0 text-[14px] font-semibold">{label}</span>
      {value !== undefined && <span className="ml-auto min-w-0 truncate text-[14px] text-ink-2">{value}</span>}
      {children}
      {chevron && <IconChevronRight size={16} className={`-mr-1 shrink-0 text-ink-2 ${value === undefined && !children ? "ml-auto" : ""}`} />}
    </button>
  );
}

/**
 * (#278) RowButton 과 같은 모양의 이동 줄 (시작 안내). 왼쪽 아이콘 18 은 선택. 눌러서 다른 화면으로 가면 버튼 대신 링크.
 * (#378) value 를 주면 설정 줄처럼 "아이콘 이름 ··· 값 ›" (아이콘 `--mute`). 없으면 예전 모양(아이콘 `--acc-ink`, 이름이 남은 폭)
 */
export function RowLink({
  href,
  label,
  icon,
  value,
  className = "",
  onClick,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  value?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const setting = value !== undefined;
  return (
    <Link href={href} onClick={onClick} className={`${rowClass} ${setting ? "" : "hover:text-acc-ink"} ${className}`}>
      {icon && <RowIcon className={setting ? "text-ink-2" : "text-acc-ink"}>{icon}</RowIcon>}
      <span className={`min-w-0 truncate text-[14px] font-semibold ${setting ? "shrink-0" : "flex-1"}`}>{label}</span>
      {setting && <span className="ml-auto min-w-0 truncate text-[14px] text-ink-2">{value}</span>}
      <IconChevronRight size={16} className="-mr-1 shrink-0 text-ink-2" />
    </Link>
  );
}

/**
 * (#378) 토글 줄: "아이콘 이름 (설명 한 줄) ··· 스위치". 줄 전체가 스위치(role=switch)라 어디를 눌러도 바뀐다.
 * 설명은 꼭 필요할 때 한 줄만(넘치면 말줄임, 전체는 읽기 이름에). RowGroup 안에서 RowButton 과 같은 높이
 */
export function ToggleRow({
  label,
  description,
  icon,
  checked,
  onChange,
  disabled = false,
  className = "",
}: {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const descId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`${rowClass} disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
    >
      {icon && <RowIcon>{icon}</RowIcon>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{label}</span>
        {description && (
          <span id={descId} className="t-sub block truncate">
            {description}
          </span>
        )}
      </span>
      <SwitchTrack checked={checked} />
    </button>
  );
}

/**
 * (#378) 줄 묶음 카드: 흰 면(`--tile`, 모서리 16, 좌우 14) 안에 RowButton, RowLink, ToggleRow 를 1px `--line` 으로 나눠 쌓는다.
 * title 을 주면 카드 위 작은 묶음 제목(13/700 `--mute`), hint 는 카드 아래 한 줄 안내(12 `--mute`).
 * 줄마다 여백이 붙어 길어지던 설정 칸을 한 장으로 묶는다 (입력 화면 규칙 4, 나머지 화면 점검 3)
 */
export function RowGroup({
  title,
  hint,
  inset = false,
  className = "",
  children,
}: {
  title?: string;
  hint?: string;
  /** 흰 면(`--tile`) 위에 놓을 때(빠른 추가 패널처럼 시트가 흰 면). 카드를 바탕 면(`--bg`)으로 뒤집는다 */
  inset?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const body = (
    <>
      {title && (
        <h2 id={titleId} className="mb-2 px-1 text-[13px] font-bold leading-[18px] text-ink-2">
          {title}
        </h2>
      )}
      <div className={`divide-y divide-line rounded-lg px-3.5 py-0.5 ${inset ? "bg-surface" : "bg-paper"}`}>{children}</div>
      {hint && <p className="t-sub mt-1.5 px-1">{hint}</p>}
    </>
  );
  return title ? (
    <section aria-labelledby={titleId} className={className}>
      {body}
    </section>
  ) : (
    <div className={className}>{body}</div>
  );
}
