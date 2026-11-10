// 선 아이콘 한 세트 (24 격자, stroke 1.8, round). 메뉴 아이콘(달력, 빈 시간, 기념일, 팀, 새 소식)은
// 디자인규칙.md 3장(#212): 바탕 도형은 둥근 사각, 채운 "겹침 조각" 은 정확히 하나.
// 장식용이라 기본 aria-hidden. 의미는 옆 글자나 aria-label 로 전한다.
import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 22, strokeWidth = 1.8, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 겹침 조각 (디자인규칙.md 3-1): 평소 선과 같은 색, 선택이면 코랄(--pri). 아이콘마다 정확히 하나 */
const pieceFill = (active?: boolean) => (active ? "var(--pri)" : "currentColor");

type PieceProps = IconProps & {
  /** 선택 상태. 겹침 조각만 코랄로 바뀐다 */
  active?: boolean;
};

export function IconCalendar({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="4.5" />
      <path d="M8 3v3.5M16 3v3.5M3.5 10h17" />
      <rect x="12.5" y="13" width="5" height="4.5" rx="1.5" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

/** 빈 시간: 둥근 사각 둘이 대각선으로 겹치고, 겹친 자리(둘 다 비는 시간)가 조각 */
export function IconFree({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="12.5" height="12.5" rx="4" />
      <rect x="8.5" y="8.5" width="12.5" height="12.5" rx="4" />
      <path d="M8.5 12.5a4 4 0 0 1 4-4h3v3a4 4 0 0 1-4 4h-3z" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

/** 시각 표시용 시계 (일정 시간 줄 등). 메뉴의 빈 시간은 IconFree */
export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  );
}

export function IconHeart({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
      <rect x="9.6" y="10.6" width="4.8" height="4.8" rx="1.2" transform="rotate(45 12 13)" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

export function IconTeam({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="9" height="9" rx="3.2" />
      <rect x="10" y="6" width="9" height="9" rx="3.2" />
      <path d="M3 20.5c.6-2.6 2.6-4 5-4h8c2.4 0 4.4 1.4 5 4" />
      <rect x="10" y="6" width="2" height="7" rx="0.8" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

/** 새 소식 종. 조각(오른쪽 위 점)은 새 소식이 있을 때만, 늘 코랄 */
export function IconBell({ unread, ...p }: IconProps & { unread?: boolean }) {
  return (
    <Svg {...p}>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z" />
      <path d="M10 21h4" />
      {unread && <circle data-piece cx="18.5" cy="5.5" r="2.6" fill="var(--pri)" stroke="none" />}
    </Svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m15 6-6 6 6 6" />
    </Svg>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function IconArrowRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m5 12 5 5L20 7" />
    </Svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  );
}

export function IconSun(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Svg>
  );
}

export function IconDevice(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="12" rx="3" />
      <path d="M8 20h8M12 16v4" />
    </Svg>
  );
}

export function IconCamera(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  );
}
