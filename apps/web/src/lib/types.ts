// docs/설계/api.md 의 응답 타입. 필드명은 명세와 동일하게 유지한다

export type GroupType = "PERSONAL" | "TEAM";

export type Member = {
  userId: number | null;
  displayName: string;
  color: string;
  profileImageUrl: string | null;
  joinedAt?: string;
  /** (#188) "이 팀 알림 받기". GroupDetail.me 와 PATCH /groups/:id/me 응답에만 (다른 멤버는 싣지 않는다) */
  notify?: boolean;
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
  /** (#196) inviteUrl + `?by=<내 표식>`. 복사, 공유는 이 주소 (lib/invite-share.ts) */
  inviteShareUrl: string | null;
  createdAt: string;
  members: Member[];
  me: Member;
};

/** 반복 주기 (#187, api.md 2.3). null 이면 한 번짜리 */
export type Repeat = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";

/** (#188) 일정 알림 시각 (푸시-알림.md 4-1, 7-2). 기본 NONE */
export type EventReminder = "NONE" | "AT_START" | "MIN_10" | "HOUR_1" | "DAY_1" | "DAY_OF_0900" | "DAY_BEFORE_0900";

/** (#188) 내 정보 > 알림 의 종류 토글 4개 (7-1). 계정 단위 */
export type NotificationSettings = { reminder: boolean; change: boolean; anniversary: boolean; join: boolean };

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
  /** (#188) 생략 = NONE. "이 일정만" 이면 그 회차에, "이후 모두" 면 (새) 원본에 저장 */
  reminder?: EventReminder;
  /** (#248) "ALL" = 모두(나중 합류자 포함), 배열 = 멤버 userId. 생성에서 생략 = [나], 수정에서 생략 = 그대로.
   *  "이 일정만" 수정에는 싣지 않는다 (서버 400) */
  participants?: "ALL" | number[];
};

export type Event = Omit<EventInput, "repeat" | "repeatUntil" | "reminder" | "participants"> & {
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
  /** (#188) 그 회차의 실제 알림 (예외 반영). 옛 API 는 없음 */
  reminder?: EventReminder;
  /** (#248) all 이면 members 는 그 팀 지금 멤버 전원, 아니면 참여자 (0 = 참여자 없음). 가입순. 반복 회차는 원본 값.
   *  옛 API 는 없음 → lib/participants participantsOf 가 등록자로 대신한다 */
  participants?: { all: boolean; members: Member[] };
};

/** PATCH 본문. "이후 모두" 에서 날짜를 그대로 두면 startsAt, endsAt 을 빼고 보낸다 (QA3-M3) */
export type EventPatchInput = Omit<EventInput, "startsAt" | "endsAt"> & Partial<Pick<EventInput, "startsAt" | "endsAt">>;

/** 단건 GET 응답. 이 회차보다 뒤에 "이 일정만" 예외가 있는지 */
export type EventDetailData = Event & { hasLaterExceptions: boolean };

/** 기념일 종류 (api.md 2.4, D-62): 함께한 날 세기(기본) / 매년 반복 / 그날만 */
export type AnniversaryKind = "COUNT_UP" | "YEARLY" | "ONCE";

/** (#269) 기념일 알림 시점: 당일 / 하루 전 / 일주일 전, 모두 오전 9시 KST. 빈 배열 = 알림 없음 */
export type AnniversaryReminder = "DAY_OF" | "DAY_BEFORE" | "WEEK_BEFORE";

export type Anniversary = {
  id: number;
  groupId: number;
  name: string;
  date: string; // YYYY-MM-DD (KST)
  kind: AnniversaryKind;
  /** (#269) 당일, 하루 전, 일주일 전 순. #269 전 API 응답에는 없다 (lib/anniversary-reminder.ts remindersOf) */
  reminders?: AnniversaryReminder[];
  creator: Member;
  createdAt: string;
};

export type AnniversaryInput = { name: string; date: string; kind?: AnniversaryKind; reminders?: AnniversaryReminder[] };

export type FreeSlots = {
  slots: { startsAt: string; endsAt: string }[];
  memberCount: number;
};

export type NewsAction = "CREATED" | "UPDATED" | "DELETED";

/** 일정 기록 한 줄. v=2 응답에서는 kind: "EVENT" 가 붙는다 (#191) */
export type NewsItem = {
  kind?: "EVENT";
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

/** (#191) 팀 활동 기록 종류 (api.md 2.6). 모르는 종류는 화면에서 거른다 */
export type ActivityType =
  | "ANNIVERSARY_CREATED"
  | "ANNIVERSARY_UPDATED"
  | "ANNIVERSARY_DELETED"
  | "MEMBER_JOINED"
  | "MEMBER_LEFT"
  | "MEMBER_DELETED"
  | "GROUP_RENAMED";

export type AnniversaryField = "name" | "date" | "kind";

/** 기념일 3종: 바뀐 뒤 값(삭제는 삭제 전 값). 수정이면 바뀐 필드와 그 필드의 이전 값 */
export type AnniversaryActivityPayload = {
  name: string;
  date: string;
  kind: AnniversaryKind;
  changed?: AnniversaryField[];
  before?: Partial<{ name: string; date: string; kind: AnniversaryKind }>;
};

/** (#191) 팀 활동 한 줄 (기념일 변경, 멤버 합류와 나가기, 팀 이름 변경) */
export type ActivityNewsItem = {
  kind: "ACTIVITY";
  id: number;
  type: ActivityType;
  /** 나간 사람, 탈퇴자는 기록 시점 이름 스냅샷 + 회색 */
  actor: Member;
  /** 기념일 3종의 대상. 삭제된 기념일이면 null */
  anniversaryId: number | null;
  /** 기념일 3종 AnniversaryActivityPayload, 팀 이름 { from, to }, 멤버 3종 {} */
  payload: Partial<AnniversaryActivityPayload> & { from?: string; to?: string };
  createdAt: string;
  isNew: boolean;
};

/** 새 소식 한 줄. 키는 `${kind}:${id}` (두 기록의 id 가 겹칠 수 있다) */
export type NewsEntry = NewsItem | ActivityNewsItem;

export type News = { items: NewsEntry[]; lastSeenAt: string | null };

export type Me = {
  id: number;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: string;
};

export type InvitePreview = {
  groupName: string;
  memberCount: number;
  /** (#196) 링크의 by 가 이 팀 현재 멤버의 표식일 때 그 사람의 팀 표시 이름 */
  inviter: { nickname: string } | null;
  /** (#196) 로그인한 내가 이미 멤버. 그때만 groupId 가 있다 */
  isMember: boolean;
  groupId: number | null;
};

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
