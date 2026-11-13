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
  /** (#305) "이 팀 달력에 내 생일 보이기". notify 와 같이 내 것에만 */
  showBirthday?: boolean;
};

export type GroupSummary = {
  id: number;
  type: GroupType;
  name: string;
  /** (#311) 주소용 공개 코드 (`?team=`). 초대 권한 없음 */
  publicCode: string;
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
  /** (#311) 주소용 공개 코드 (`?team=`) */
  publicCode: string;
  createdAt: string;
  members: Member[];
  me: Member;
};

/** 반복 주기 (#187, api.md 2.3). null 이면 한 번짜리 */
export type Repeat = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";

/** (#188) 일정 알림 시각 (푸시-알림.md 4-1, 7-2). 기본 NONE */
export type EventReminder = "NONE" | "AT_START" | "MIN_10" | "HOUR_1" | "DAY_1" | "DAY_OF_0900" | "DAY_BEFORE_0900";

/** (#188) 내 정보 > 알림 의 종류 토글 4개 (7-1). 계정 단위 */
/** (#277) weekly 주간 요약(기본 켬), weeklyNudge 다 같이 비는 시간(조용한 팀 깨우기, 기본 끔 D-204) */
/** (#189) poll 약속 투표(열림, 마감, 정함). 기본 켬 */
export type NotificationSettings = { reminder: boolean; change: boolean; anniversary: boolean; join: boolean; weekly: boolean; weeklyNudge: boolean; poll: boolean };

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
  /** (#343) 일정 색 (MEMBER_COLORS 키 하나). null = 자동(참여자 색). 생성에서 생략 = 자동, 수정에서 생략 = 그대로.
   *  반복 "이 일정만" 수정에는 싣지 않는다 (서버 400, D-215). 옛 API 응답에는 없음 = 자동 */
  color?: string | null;
};

export type Event = Omit<EventInput, "repeat" | "repeatUntil" | "reminder" | "participants"> & {
  id: number;
  groupId: number;
  /** (#311) 주소용 공개 코드 (`/events/<코드>`) */
  publicCode: string;
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
  /** (#190) 그 회차의 참석 여부 집계. 옛 API 는 없음 → 응답 줄을 그리지 않는다 */
  rsvp?: RsvpSummary;
  /** (#190) 그 회차의 반응 집계. 옛 API 는 없음 */
  reactions?: ReactionSummary;
};

/** (#190) 참석 여부. 응답 안 함은 null */
export type Rsvp = "GOING" | "NOT_GOING" | "MAYBE";
/** (#190) 짧은 반응. 화면 글자: 좋아요, 기대돼요, 확인했어요 */
export type Reaction = "LIKE" | "EXCITED" | "ACK";

/** (#190) pending = 참여자 중 아직 응답하지 않은 사람 수 */
export type RsvpSummary = { going: number; notGoing: number; maybe: number; pending: number; mine: Rsvp | null };
export type ReactionSummary = Record<Reaction, number> & { mine: Reaction | null };

/** (#190) 단건의 사람별 응답 (참여자 가입순). stale = 응답한 뒤 그 회차 시각이 바뀜 */
export type RsvpMember = { member: Member; status: Rsvp | null; respondedAt: string | null; stale: boolean };
export type ReactionMember = { member: Member; reaction: Reaction };

/** PATCH 본문. "이후 모두" 에서 날짜를 그대로 두면 startsAt, endsAt 을 빼고 보낸다 (QA3-M3) */
export type EventPatchInput = Omit<EventInput, "startsAt" | "endsAt"> & Partial<Pick<EventInput, "startsAt" | "endsAt">>;

/** 단건 GET 응답. 이 회차보다 뒤에 "이 일정만" 예외가 있는지 */
export type EventDetailData = Event & {
  hasLaterExceptions: boolean;
  /** (#190) 단건에만. 옛 API 는 없음 */
  rsvpMembers?: RsvpMember[];
  reactionMembers?: ReactionMember[];
};

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
  /** (#305) 멤버 생일을 기념일 모양으로 바꾼 항목이면 그 사람 userId (lib/birthday.ts). 서버 기념일에는 없다 */
  birthdayOf?: number;
};

/** (#305) GET /groups/:id/birthdays 한 줄. date 는 'MM-DD' (연도 없음) */
export type Birthday = { member: Member; date: string };

/** (#305) GET /me, PATCH /me/birthday 의 내 생일. date 'MM-DD' 또는 null, reminders 는 팀원에게 알리는 시점 */
export type BirthdaySettings = { date: string | null; reminders: AnniversaryReminder[] };

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
  /** (#311) 원본의 공개 코드. 삭제됐으면 null */
  eventCode: string | null;
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
  | "GROUP_RENAMED"
  /** (#279) ICS 파일로 일정을 가져옴. payload { count } */
  | "EVENTS_IMPORTED"
  /** (#190) 참석 여부를 정하거나 바꿈. payload RsvpActivityPayload */
  | "EVENT_RSVP"
  /** (#189) 약속 투표를 열었다 { pollId, code, title }, 시간을 정했다 (+ eventCode, startsAt, endsAt, allDay) */
  | "POLL_CREATED"
  | "POLL_CLOSED";

/** (#190) 참석 여부 기록. occurrence 는 반복 회차만, 한 번짜리는 null */
export type RsvpActivityPayload = {
  eventId: number;
  eventCode: string;
  occurrence: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: Rsvp;
};

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
  /** 기념일 3종 AnniversaryActivityPayload, 팀 이름 { from, to }, 가져오기 { count }, 멤버 3종 {} (#274 일정 링크 합류는 { via: "EVENT_SHARE" }) */
  payload: Partial<AnniversaryActivityPayload> & { from?: string; to?: string; count?: number; via?: string } & Partial<Omit<RsvpActivityPayload, "title">> &
    Partial<PollActivityPayload>;
  createdAt: string;
  isNew: boolean;
};

/** (#189) 투표 기록 payload. title 은 투표 제목(정하면 일정 제목) */
export type PollActivityPayload = {
  pollId: number;
  code: string;
  title: string;
  eventId: number;
  eventCode: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
};

/** 새 소식 한 줄. 키는 `${kind}:${id}` (두 기록의 id 가 겹칠 수 있다) */
export type NewsEntry = NewsItem | ActivityNewsItem;

export type News = { items: NewsEntry[]; lastSeenAt: string | null };

/** (#300) 처음 여는 달력. LAST 마지막에 본 달력, PERSONAL 내 달력, GROUP 고정한 팀 (groupId 는 GROUP 일 때만) */
export type StartCalendarMode = "LAST" | "PERSONAL" | "GROUP";
export type StartCalendar = { mode: StartCalendarMode; groupId: number | null };

export type Me = {
  id: number;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: string;
  /** (#300) GET /me 에만 있다. PATCH /me 응답에는 없어 화면이 앞 값을 이어 쓴다 */
  startCalendar?: StartCalendar;
  /** (#305) GET /me 에만 있다 (PATCH /me 응답에는 없어 앞 값을 이어 쓴다) */
  birthday?: BirthdaySettings;
};

export type InvitePreview = {
  groupName: string;
  memberCount: number;
  /** (#196) 링크의 by 가 이 팀 현재 멤버의 표식일 때 그 사람의 팀 표시 이름 */
  inviter: { nickname: string } | null;
  /** (#196) 로그인한 내가 이미 멤버. 그때만 groupId, groupCode 가 있다 */
  isMember: boolean;
  groupId: number | null;
  /** (#311) `/calendar?team=<코드>` 로 간다 */
  groupCode: string | null;
};

/**
 * (#193) 내 외부 캘린더 구독 주소 (api.md 2.12). 팀마다 사람마다 하나.
 * httpsUrl 은 복사용, webcalUrl 은 애플 캘린더 구독 창, googleAddUrl 은 구글 캘린더 "URL로 추가" (컴퓨터 웹에서만)
 */
export type CalendarFeed = {
  httpsUrl: string;
  webcalUrl: string;
  googleAddUrl: string;
  includeMemo: boolean;
  includeAnniversaries: boolean;
  createdAt: string;
  /** 외부 캘린더가 마지막으로 가져간 시각 (1분 단위). 아직 없으면 null */
  lastFetchedAt: string | null;
};

/** (#274) 보내는 쪽 일정 링크 (api.md 2.10). url = `${WEB_ORIGIN}/join/e/${token}` */
export type EventShareLink = { token: string; url: string; expiresAt: string };

/** (#274) 받는 쪽 미리보기 (api.md 2.10). 메모, 참여자, 등록자, id(비멤버)는 없다 */
export type EventSharePreview = {
  groupName: string;
  memberCount: number;
  sharer: { displayName: string } | null;
  /** (#343) color: 일정 색. null(자동)이나 옛 API(없음)면 카드는 기본 강조색 */
  event: { title: string; startsAt: string; endsAt: string; allDay: boolean; repeat: Repeat | null; occurrence: string | null; color?: string | null };
  expiresAt: string;
  viewer: { member: true; groupId: number; eventId: number; groupCode: string; eventCode: string; occurrence: string | null; date: string } | { member: false };
};

/** (#274) 일정 링크 합류 결과. 착지 정보 (#311 eventCode 로 `/events/<코드>`) */
export type EventShareJoin = { group: GroupDetail; eventId: number; eventCode: string; occurrence: string | null; date: string };

// api.md 2.2 멤버 색, 일정 색 팔레트 (자동 배정, 설정 화면, 일정 폼). 화면 이름은 lib/colors COLOR_NAMES (8번째 = 핑크, D-215)
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

// ── (#279) ICS 파일 가져오기 (api.md 2.9) ──

/** (#314) all = 파일 전체 */
export type ImportRange = "future" | "year" | "all";
export type ImportParticipants = "ALL" | "ME";
export type ImportSkipReason = "DUPLICATE" | "CANCELLED" | "TOO_OLD" | "TOO_LONG" | "INVALID" | "OVER_LIMIT";
export type ImportWarning = "UNKNOWN_TZID" | "TRUNCATED_TITLE";

export type ImportPreview = {
  /** 파일 안 VEVENT 수 */
  total: number;
  /** 넣을 일정 수 (반복으로 옮긴 것은 1개, 펼친 회차는 각각) */
  toCreate: number;
  recurringKept: number;
  /** 반복을 옮길 수 없어 펼친 회차 수와 그 원본 수 */
  expanded: number;
  expandedSeries: number;
  skipped: { reason: ImportSkipReason; count: number }[];
  firstStartsAt: string | null;
  lastStartsAt: string | null;
  warnings: ImportWarning[];
  sample: { title: string; startsAt: string; endsAt: string; allDay: boolean; repeat: Repeat | null }[];
  /** (#314) 넣을 일정 전부 (시작 순, 최대 1,000). key 를 넣기 요청의 include 로 돌려준다 */
  items: ImportItem[];
};

/** (#314) 미리보기 목록의 한 줄. key 는 서버의 중복 방지 해시 */
export type ImportItem = { key: string; title: string; startsAt: string; endsAt: string; allDay: boolean; repeat: Repeat | null };

export type ImportResult = {
  importId: number | null;
  created: number;
  skipped: { reason: ImportSkipReason; count: number }[];
};

/* ---------- (#276) 할 일 목록 (api.md 2.11) ---------- */

/** 목록 화면 한 줄. 마지막으로 바꾼 사람(editor)은 탈퇴했으면 "탈퇴한 멤버" */
export type TodoListSummary = {
  id: number;
  publicCode: string;
  name: string;
  openCount: number;
  doneCount: number;
  editor: Member;
  updatedAt: string;
};

export type TodoList = {
  id: number;
  publicCode: string;
  groupId: number;
  groupCode: string;
  name: string;
  creator: Member;
  editor: Member;
  createdAt: string;
  updatedAt: string;
};

export type TodoItem = {
  id: number;
  listId: number;
  text: string;
  done: boolean;
  doneAt: string | null;
  /** 미완료면 null */
  doneBy: Member | null;
  creator: Member;
  createdAt: string;
  updatedAt: string;
};

/** GET /todo-lists/:code */
export type TodoListDetail = { list: TodoList; items: TodoItem[] };

/* ---------- (#189) 약속 투표 (api.md 2.13) ---------- */

export type PollStatus = "OPEN" | "CLOSED";

/** 후보 하나. past = 시작이 지났다 (고를 수도 정할 수도 없다). voters 는 가입순 */
export type PollOption = { id: number; startsAt: string; endsAt: string; allDay: boolean; past: boolean; voters: Member[] };

export type Poll = {
  id: number;
  publicCode: string;
  groupId: number;
  groupCode: string;
  title: string;
  status: PollStatus;
  deadline: string | null;
  /** 마감이 지났다 (진행 중만). 표는 못 하고 정하기는 된다 */
  expired: boolean;
  creator: Member;
  createdAt: string;
  closedAt: string | null;
  /** 정해서 생긴 일정. 지워졌으면 null */
  eventId: number | null;
  eventCode: string | null;
  decidedOptionId: number | null;
  participants: { all: boolean; members: Member[] };
  options: PollOption[];
  myVotes: number[];
  canVote: boolean;
};

/** 홈 "정하는 중" 카드 */
export type PollSummary = {
  id: number;
  publicCode: string;
  title: string;
  status: PollStatus;
  deadline: string | null;
  expired: boolean;
  eventId: number | null;
  eventCode: string | null;
  voterCount: number;
  targetCount: number;
  votedByMe: boolean;
  /** 모든 후보가 지났다 ("지난 투표") */
  allPast: boolean;
  createdAt: string;
  closedAt: string | null;
};

export type PollOptionInput = { startsAt: string; endsAt: string; allDay: boolean };

export type PollInput = { title: string; options: PollOptionInput[]; deadline?: string | null; participants?: "ALL" | number[] };

/** 정하기 응답. warning BUSY_NOW = 그 사이 대상 중 누가 그 시간에 일정이 생겼다 (정하기는 됐다) */
export type PollConfirmResult = { poll: Poll; event: Event; warning: "BUSY_NOW" | null };
