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

/** (#276) 할 일: 둥근 사각 틀 + 체크, 조각은 왼쪽 위 작은 둥근 사각 (디자인규칙.md 3-2) */
export function IconTodo({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="m8.5 13.2 2.6 2.6 5-5.6" />
      <rect x="6.3" y="6.3" width="3.6" height="3.6" rx="1.1" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

/** (#189) 약속 투표: 둥근 사각 둘이 겹치고 앞 사각에 체크, 조각은 겹친 자리 (디자인규칙.md 3-2) */
export function IconPoll({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="12" height="12" rx="3.5" />
      <rect x="9" y="9" width="12" height="12" rx="3.5" />
      <path d="m13.2 16.4 1.9 1.9 3.5-3.9" />
      <rect x="9" y="9" width="4.6" height="4.6" rx="1.4" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

/** 더 보기 ⋯ (목록 상세 머리줄 메뉴) */
export function IconMore(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
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

/** (#245) 이메일: 둥근 사각 봉투 + 덮개. 조각은 덮개 꼭짓점의 45도 작은 사각 (디자인규칙.md 3-1) */
export function IconMail({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="4" />
      <path d="M6.5 8.5 12 12.5l5.5-4" />
      <rect x="10.3" y="11.3" width="3.4" height="3.4" rx="1" transform="rotate(45 12 13)" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

/** (#274) 공유. 일정 상세 제목줄 (닫기 왼쪽). 겹침 조각 없음 (디자인규칙 3장 "하나 이하") */
export function IconShare(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 14.5V3.5M8 7.5l4-4 4 4" />
      <path d="M5 12.5V17a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-4.5" />
    </Svg>
  );
}

/** (#199) 일정 검색 돋보기. 렌즈는 둥근 사각(3-1 원 피하기), 겹침 조각 없음 */
export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="13" height="13" rx="4.5" />
      <path d="M15 15l5.5 5.5" />
    </Svg>
  );
}

/** (#199) 장소 핀. 겹침 조각은 핀 안 작은 둥근 사각 하나 */
export function IconPin({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <rect data-piece x="10" y="8" width="4" height="4" rx="1.2" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

/** (#199) 지도 크게 보기 (네 모서리 바깥 화살표). 겹침 조각 없음 */
export function IconExpand(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5V9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15M15 20h3.5a1.5 1.5 0 0 0 1.5-1.5V15" />
    </Svg>
  );
}

/** (#378) 반복: 위아래로 도는 두 화살표. 설정 줄 "반복" 의 아이콘. 겹침 조각 없음 */
export function IconRepeat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 11a7 7 0 0 1 12-4.9L18 8" />
      <path d="M18 4v4h-4" />
      <path d="M20 13a7 7 0 0 1-12 4.9L6 16" />
      <path d="M6 20v-4h4" />
    </Svg>
  );
}

/** (#378) 색: 물감 방울. 조각은 방울 아래쪽 작은 둥근 사각 (장소 핀과 위아래가 반대). 설정 줄 "색" 의 아이콘 */
export function IconPalette({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5s-6 6.3-6 10.6a6 6 0 0 0 12 0C18 9.8 12 3.5 12 3.5z" />
      <rect data-piece x="10" y="13" width="4" height="4" rx="1.2" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

/** (#378) 생일: 둥근 사각 케이크 + 크림 물결 + 초 하나. 조각은 초의 불꽃(작은 둥근 사각). 기념일 목록에서 생일 줄 표시 */
export function IconCake({ active, ...p }: PieceProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="11" width="16" height="9.5" rx="3.5" />
      <path d="M4 15c2.7 1.4 5.3 1.4 8 0s5.3-1.4 8 0" />
      <path d="M12 11V7.6" />
      <rect data-piece x="10.6" y="3" width="2.8" height="3.6" rx="1.3" fill={pieceFill(active)} stroke="none" />
    </Svg>
  );
}

/** (#198) 열쇠: 내 정보 > 로그인 방법 */
export function IconKey(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7.5" cy="16.5" r="4.5" />
      <path d="M10.7 13.3 20 4" />
      <path d="m17 7 2.5 2.5" />
      <path d="m14.5 9.5 2 2" />
    </Svg>
  );
}

/** 카카오톡 말풍선 심볼 20 (KakaoButton 과 같은 모양). 카카오 공유 버튼 안 (#195, #274) */
export function KakaoSymbol() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" className="shrink-0">
      <path
        fill="#000000"
        d="M12 3C6.48 3 2 6.58 2 10.9c0 2.78 1.84 5.22 4.62 6.6l-.94 3.48c-.08.3.26.54.52.37l4.15-2.76c.54.07 1.09.11 1.65.11 5.52 0 10-3.58 10-7.9S17.52 3 12 3z"
      />
    </svg>
  );
}
