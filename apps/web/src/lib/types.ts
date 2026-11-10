// docs/설계/api.md 의 응답 타입. 필드명은 명세와 동일하게 유지한다

export type GroupType = "PERSONAL" | "TEAM";

export type Member = {
  userId: number | null;
  displayName: string;
  color: string;
  profileImageUrl: string | null;
  joinedAt?: string;
};

export type GroupSummary = {
  id: number;
  type: GroupType;
  name: string;
  memberCount: number;
  me: { color: string; displayName: string };
  unreadNewsCount: number;
};

export type GroupDetail = {
  id: number;
  type: GroupType;
  name: string;
  inviteCode: string | null;
  inviteUrl: string | null;
  createdAt: string;
  members: Member[];
  me: Member;
};

/** 반복 주기 (#187, api.md 2.3). null 이면 한 번짜리 */
export type Repeat = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";

/** 반복 일정 수정/삭제 범위 (쿼리 값). 이 일정만 / 이후 모두 */
export type EventScope = "this" | "following";

export type EventInput = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  memo?: string;
  /** 생략/null = 한 번짜리. "이 일정만" 수정에는 보내지 않는다 (#187) */
  repeat?: Repeat | null;
  /** 'YYYY-MM-DD' (KST, 그날 시작하는 회차 포함). 생략/null = 계속 */
  repeatUntil?: string | null;
};

export type Event = Omit<EventInput, "repeat" | "repeatUntil"> & {
  id: number;
  groupId: number;
  creator: Member;
  createdAt: string;
  updatedAt: string;
  repeat: Repeat | null;
  repeatUntil: string | null;
  /** 회차의 원래 날짜 (KST). 한 번짜리는 null. 화면 키는 eventKey() */
  occurrence: string | null;
  /** 반복이면 원본 첫 회차 시작 ("매주 목요일" 표시용) */
  seriesStartsAt: string | null;
  /** (#228) 반복 기준 날짜 'YYYY-MM-DD'. 매월은 일, 매년은 월일. null 이면 seriesStartsAt 의 날짜 (D-71) */
  repeatAnchor: string | null;
};

/** PATCH 본문. "이후 모두" 에서 날짜를 그대로 두면 startsAt, endsAt 을 빼고 보낸다 (QA3-M3) */
export type EventPatchInput = Omit<EventInput, "startsAt" | "endsAt"> & Partial<Pick<EventInput, "startsAt" | "endsAt">>;

/** 단건 GET 응답. 이 회차보다 뒤에 "이 일정만" 예외가 있는지 */
export type EventDetailData = Event & { hasLaterExceptions: boolean };

/** 기념일 종류 (api.md 2.4, D-62): 함께한 날 세기(기본) / 매년 반복 / 그날만 */
export type AnniversaryKind = "COUNT_UP" | "YEARLY" | "ONCE";

export type Anniversary = {
  id: number;
  groupId: number;
  name: string;
  date: string; // YYYY-MM-DD (KST)
  kind: AnniversaryKind;
  creator: Member;
  createdAt: string;
};

export type AnniversaryInput = { name: string; date: string; kind?: AnniversaryKind };

export type FreeSlots = {
  slots: { startsAt: string; endsAt: string }[];
  memberCount: number;
};

export type NewsAction = "CREATED" | "UPDATED" | "DELETED";

export type NewsItem = {
  id: number;
  action: NewsAction;
  eventId: number | null;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** 변경 시점의 반복 주기 (#187) */
  repeat: Repeat | null;
  /** 반복 일정에서 고른 범위. 한 번짜리, 새 반복 추가는 null */
  scope: "THIS" | "FOLLOWING" | null;
  /** 범위를 고른 회차 날짜 (KST) */
  occurrence: string | null;
  actor: Member;
  createdAt: string;
  isNew: boolean;
};

export type News = { items: NewsItem[]; lastSeenAt: string | null };

export type Me = {
  id: number;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: string;
};

export type InvitePreview = { groupName: string; memberCount: number };

export type ApiErrorBody = { error: { code: string; message: string } };

// api.md 2.2 멤버 색 팔레트 (자동 배정, 설정 화면 팔레트)
export const MEMBER_COLORS = [
  "#F26D6D",
  "#F2994A",
  "#F2C94C",
  "#6FCF97",
  "#56CCF2",
  "#5B6CF4",
  "#A66CF4",
  "#F279B5",
] as const;

export const LEFT_MEMBER: Member = {
  userId: null,
  displayName: "탈퇴한 멤버",
  color: "#9CA3AF",
  profileImageUrl: null,
};
