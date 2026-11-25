// API_MOCK=1 일 때 쓰는 메모리 픽스처. 백엔드가 없을 때 화면 확인용.
// 날짜는 실행 시점의 KST 이번 달 기준으로 만든다.
import { sameDayInYear } from "@/lib/anniversary";
import {
  addDays,
  dateKeyOf,
  keyOf,
  kstToIso,
  parseKey,
  todayKey,
  toKst,
} from "@/lib/date";
import type {
  ActivityNewsItem,
  ActivityType,
  AnniversaryKind,
  AnniversaryReminder,
  EventReminder,
  GroupType,
  Member,
  NotificationSettings,
  Reaction,
  Repeat,
  Rsvp,
  StartCalendar,
} from "@/lib/types";
import { MEMBER_COLORS } from "@/lib/types";
import type { MockException, MockPlace } from "./recurrence";

export type UserRow = {
  id: number;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: string;
  /** (#188) 알림 종류 설정. 없으면 모두 켬 */
  notify?: NotificationSettings;
  /** (#300) 처음 여는 달력. 없으면 LAST */
  startCalendar?: StartCalendar;
  /** (#305) 내 생일 'MM-DD'. 없으면 null */
  birthday?: string | null;
  /** (#305) 팀원에게 알리는 시점. 없으면 당일만 */
  birthdayReminders?: AnniversaryReminder[];
  /** (#515) 역할. 없으면 user. 목 기본 사용자(나)는 관리자 화면을 볼 수 있게 admin */
  role?: "user" | "admin";
  /** (#515) 공지 목록을 본 시각. 없으면 아직 */
  noticesSeenAt?: string | null;
  /** (#515) 로그인 방법 (관리자 사용자 목록). 없으면 KAKAO */
  providers?: string[];
  /** (#528) 마지막 앱 로그인. 없으면 기록 없음 */
  lastAppLoginAt?: string | null;
};

/** (#515) 목 공지. publishedAt null = 초안 */
export type NoticeRow = {
  id: number;
  title: string;
  body: string;
  kind: "notice" | "update" | "maintenance";
  pinned: boolean;
  publishedAt: string | null;
  /** (#528) 푸시를 보낸 시각 */
  pushedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** (#515) 목 관리자 조치 기록 */
export type AdminLogRow = { id: number; adminId: number; action: string; targetType: "notice" | "user" | "group" | "event"; targetId: number; reason: string | null; createdAt: string };
/** (#515) 목 운영 숨김 (D-286) */
export type MockHidden = { reason: string; hiddenAt: string; hiddenById: number };
export type GroupRow = {
  id: number;
  type: GroupType;
  name: string;
  inviteCode: string | null;
  createdAt: string;
  /** (#515) 운영 숨김. 없으면 정상 */
  hidden?: MockHidden | null;
};
export type MembershipRow = {
  userId: number;
  groupId: number;
  color: string;
  displayName: string | null;
  joinedAt: string;
  lastSeenAt: string | null;
  /** (#188) 이 팀 알림 받기. 없으면 켬 */
  notify?: boolean;
  /** (#305) 이 팀 달력에 내 생일 보이기. 없으면 켬 */
  showBirthday?: boolean;
};
export type EventRow = {
  id: number;
  groupId: number;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  memo: string | null;
  creatorId: number | null;
  createdAt: string;
  updatedAt: string;
  /** (#187) null 이면 한 번짜리 */
  repeat: Repeat | null;
  repeatUntil: string | null;
  /** (#228) 반복 기준 날짜. null 이면 첫 회차 날짜 (D-71) */
  repeatAnchor?: string | null;
  /** (#187) "이 일정만" 예외. 원래 회차 날짜 기준 */
  exceptions: MockException[];
  /** (#515) 운영 숨김. 없으면 정상 */
  hidden?: MockHidden | null;
  /** (#188) 알림. 없으면 NONE */
  reminder?: EventReminder;
  /** (#248) true(또는 없음) = "모두". 기존 시드는 DB 기본값처럼 모두 (설계 2-1) */
  allMembers?: boolean;
  /** (#248) allMembers 가 false 일 때 참여자 userId. 비면 "참여자 없음" */
  participantIds?: number[];  /** (#343) 일정 색 (MEMBER_COLORS 키). 없거나 null 이면 자동 (D-215) */
  color?: string | null;
  /** (#199) 장소. 없거나 null 이면 없음 */
  place?: MockPlace | null;
};
/** (#188) 푸시 기기 (푸시-알림.md 3장 PushDevice) */
export type PushDeviceRow = { token: string; userId: number; platform: "IOS" | "ANDROID"; appVersion: string; lastSeenAt: string; /** (#528) 등록 시각. 없으면 lastSeenAt */ createdAt?: string };
export type AnniversaryRow = {
  id: number;
  groupId: number;
  name: string;
  date: string;
  kind: AnniversaryKind;
  /** (#269) 알림 시점. 없으면 DB 기본값처럼 당일만 */
  reminders?: AnniversaryReminder[];
  creatorId: number | null;
  createdAt: string;
};
export type EventLogRow = {
  id: number;
  groupId: number;
  action: "CREATED" | "UPDATED" | "DELETED";
  eventId: number | null;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  repeat: Repeat | null;
  scope: "THIS" | "FOLLOWING" | null;
  occurrence: string | null;
  actorId: number | null;
  createdAt: string;
};

/** (#276) 할 일 목록, 항목 (설계 할일-목록.md 1장) */
export type TodoListRow = { id: number; groupId: number; name: string; creatorId: number | null; editorId: number | null; createdAt: string; updatedAt: string };
export type TodoItemRow = {
  id: number;
  listId: number;
  text: string;
  done: boolean;
  doneAt: string | null;
  doneById: number | null;
  creatorId: number | null;
  createdAt: string;
  updatedAt: string;
};

/** (#189) 약속 투표 (설계 약속-투표.md 1장). 후보와 표를 한 행에 */
export type PollRow = {
  id: number;
  groupId: number;
  title: string;
  status: "OPEN" | "CLOSED";
  deadline: string | null;
  allMembers: boolean;
  participantIds: number[];
  creatorId: number | null;
  eventId: number | null;
  decidedOptionId: number | null;
  createdAt: string;
  closedAt: string | null;
  options: { id: number; startsAt: string; endsAt: string; allDay: boolean; voterIds: number[] }[];
};

/** (#191) 팀 활동 기록 (설계 GroupActivity). actorName 은 기록 시점 표시 이름 스냅샷 */
export type ActivityRow = {
  id: number;
  groupId: number;
  type: ActivityType;
  actorId: number | null;
  actorName: string;
  anniversaryId: number | null;
  /** (#189) POLL_CLOSED 는 숨길 일정 기록 id(eventLogId) 를 함께 둔다 (D-236) */
  payload: ActivityNewsItem["payload"] & { eventLogId?: number };
  createdAt: string;
};

export type Store = {
  users: UserRow[];
  groups: GroupRow[];
  memberships: MembershipRow[];
  events: EventRow[];
  anniversaries: AnniversaryRow[];
  logs: EventLogRow[];
  /** (#191) 없으면 빈 목록 */
  activities?: ActivityRow[];
  /** (#188) 없으면 빈 목록 */
  pushDevices?: PushDeviceRow[];
  /** (#198) 로그인 방법 (D-257). 없으면 첫 조회 때 나는 카카오 하나로 채운다 */
  authAccounts?: { id: number; userId: number; provider: "KAKAO" | "APPLE" | "EMAIL"; label: string; createdAt: string }[];
  /** (#276) 없으면 빈 목록 */
  todoLists?: TodoListRow[];
  todoItems?: TodoItemRow[];
  /** (#193) 구독 주소. 없으면 빈 목록 */
  calendarFeeds?: CalendarFeedRow[];
  /** (#190) 회차별 참석 여부, 반응. 없으면 빈 목록 */
  rsvps?: RsvpRow[];
  reactions?: ReactionRow[];
  /** (#189) 약속 투표. 없으면 빈 목록 */
  polls?: PollRow[];
  /** (#375) 되돌릴 수 있게 보관한 일정 삭제. 없으면 빈 목록 */
  deletions?: DeletionRow[];
  /** (#450) AI 비서: 사용자별 동의 시각, 오늘(KST) 사용 횟수. 없으면 아무도 동의 안 함 */
  assistant?: { consent: Record<number, string>; usage: Record<number, { day: string; count: number }> };
  /** (#515) 공지, 관리자 조치 기록. 없으면 빈 목록 */
  notices?: NoticeRow[];
  adminLogs?: AdminLogRow[];
  seq: number;
};

/**
 * (#375) 목 삭제 보관 (D-251). 지우기 직전 일정 행(반복이면 예외 포함) 통째와 그 일정의 응답, 반응.
 * 되돌리면 행을 그대로 바꿔 넣는다. logIds 는 행째 지울 때 끊긴 기록
 */
export type DeletionRow = {
  id: number;
  groupId: number;
  eventId: number;
  createdAt: string;
  logId: number;
  event: EventRow;
  rsvps: RsvpRow[];
  reactions: ReactionRow[];
  logIds: number[];
};

/** (#190) 참석 여부 한 줄. occurrence 는 반복 회차 날짜, 한 번짜리는 시작 KST 날짜 */
export type RsvpRow = { eventId: number; occurrence: string; userId: number; status: Rsvp; seenStartsAt: string; seenEndsAt: string; updatedAt: string };
export type ReactionRow = { eventId: number; occurrence: string; userId: number; kind: Reaction };

/** (#193) 목 구독 주소 한 줄. 토큰은 목이라 그대로 둔다 (실제 API 는 해시만) */
export type CalendarFeedRow = {
  userId: number;
  groupId: number;
  token: string;
  includeMemo: boolean;
  includeAnniversaries: boolean;
  createdAt: string;
  lastFetchedAt: string | null;
};

export const ME_ID = 1;
export const OTHER_ID = 2;
export const PERSONAL_ID = 1;
export const TEAM_ID = 2;
const OTHER_PERSONAL_ID = 3;
export const TEAM_INVITE_CODE = "WM7K2Q";
/** (#248) 참여자 화면 확인용 4인 팀 (엄마, 아빠 포함) */
export const FAMILY_ID = 4;
export const MOM_ID = 3;
export const DAD_ID = 4;

/** (#311) 목 공개 코드. 실제 API 는 랜덤 소문자 영숫자 8자, 목은 id 로 정해지는 8자 ("team2xxx", "evnt12xx") */
export const mockGroupCode = (id: number) => `team${id}`.padEnd(8, "x").slice(0, 8);
export const mockEventCode = (id: number) => `evnt${id}`.padEnd(8, "x").slice(0, 8);
/** (#276) 할 일 목록 공개 코드 ("todo3xxx") */
export const mockTodoCode = (id: number) => `todo${id}`.padEnd(8, "x").slice(0, 8);
/** (#189) 투표 공개 코드 */
export const mockPollCode = (id: number) => `poll${id}`.padEnd(8, "x").slice(0, 8);

const WEB_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:3000";
export const inviteUrlOf = (code: string) => `${WEB_ORIGIN}/join/${code}`;

/**
 * (#196) 목 보낸 사람 표식. 실제 API 는 HMAC(D-157), 목은 팀과 사용자로 정해지는 10자 (FNV-1a).
 * 화면 확인용이라 비밀은 없다. 맞는 표식 예: inviteMarkerOf(2, 1) (우리 둘 + 나)
 */
export function inviteMarkerOf(groupId: number, userId: number): string {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let h = 0x811c9dc5;
  for (const ch of `wwm-mock:${groupId}:${userId}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  let out = "";
  for (let i = 0; i < 10; i++) {
    h = Math.imul(h ^ (i + 1), 0x01000193) >>> 0;
    out += ALPHA[(h >>> 11) & 63];
  }
  return out;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export function buildStore(): Store {
  const today = todayKey();
  const { y, m } = toKst(Date.now());
  const d = (day: number) => keyOf(y, m, Math.min(day, 28));

  const users: UserRow[] = [
    // (#515) 나는 관리자 (관리자 화면 확인용)
    { id: ME_ID, nickname: "지우", profileImageUrl: null, createdAt: hoursAgo(24 * 40), role: "admin" },
    // (#305) 하늘은 9일 뒤가 생일 (기념일 화면, 달력에 "하늘 생일")
    { id: OTHER_ID, nickname: "하늘", profileImageUrl: null, createdAt: hoursAgo(24 * 38), birthday: addDays(today, 9).slice(5) },
    { id: MOM_ID, nickname: "엄마", profileImageUrl: null, createdAt: hoursAgo(24 * 30) },
    { id: DAD_ID, nickname: "아빠", profileImageUrl: null, createdAt: hoursAgo(24 * 30) },
  ];

  const groups: GroupRow[] = [
    { id: PERSONAL_ID, type: "PERSONAL", name: "내 달력", inviteCode: null, createdAt: hoursAgo(24 * 40) },
    { id: TEAM_ID, type: "TEAM", name: "우리 둘", inviteCode: TEAM_INVITE_CODE, createdAt: hoursAgo(24 * 38) },
    { id: OTHER_PERSONAL_ID, type: "PERSONAL", name: "내 달력", inviteCode: null, createdAt: hoursAgo(24 * 38) },
    { id: FAMILY_ID, type: "TEAM", name: "우리 가족", inviteCode: "FAM4ZK", createdAt: hoursAgo(24 * 30) },
  ];

  const memberships: MembershipRow[] = [
    { userId: ME_ID, groupId: PERSONAL_ID, color: "#F26D6D", displayName: null, joinedAt: hoursAgo(24 * 40), lastSeenAt: hoursAgo(24 * 2) },
    { userId: ME_ID, groupId: TEAM_ID, color: "#F26D6D", displayName: null, joinedAt: hoursAgo(24 * 38), lastSeenAt: hoursAgo(20) },
    { userId: OTHER_ID, groupId: TEAM_ID, color: "#F2994A", displayName: null, joinedAt: hoursAgo(24 * 37), lastSeenAt: hoursAgo(1) },
    { userId: OTHER_ID, groupId: OTHER_PERSONAL_ID, color: "#F2994A", displayName: null, joinedAt: hoursAgo(24 * 38), lastSeenAt: null },
    { userId: ME_ID, groupId: FAMILY_ID, color: "#F26D6D", displayName: null, joinedAt: hoursAgo(24 * 30), lastSeenAt: hoursAgo(2) },
    { userId: MOM_ID, groupId: FAMILY_ID, color: "#6FCF97", displayName: null, joinedAt: hoursAgo(24 * 29), lastSeenAt: null },
    { userId: DAD_ID, groupId: FAMILY_ID, color: "#56CCF2", displayName: null, joinedAt: hoursAgo(24 * 29), lastSeenAt: null },
    { userId: OTHER_ID, groupId: FAMILY_ID, color: "#F2994A", displayName: null, joinedAt: hoursAgo(24 * 28), lastSeenAt: null },
  ];

  // 반복 픽스처 첫 회차: 내일 요일, 2주 전
  const weeklyStart = addDays(today, -13);
  const ev = (
    id: number,
    groupId: number,
    title: string,
    startKey: string,
    start: string,
    endKey: string,
    end: string,
    creatorId: number,
    allDay = false,
    memo: string | null = null,
  ): EventRow => ({
    id,
    groupId,
    title,
    startsAt: kstToIso(startKey, start),
    endsAt: kstToIso(endKey, end),
    allDay,
    memo,
    creatorId,
    createdAt: hoursAgo(30),
    updatedAt: hoursAgo(30),
    repeat: null,
    repeatUntil: null,
    exceptions: [],
  });

  // 팀 일정 6개 (이번 달) + 개인 일정 2개 (빈 시간 계산에만 영향)
  const events: EventRow[] = [
    // (#199) 장소: 고른 장소(카카오 ID + 검색어, 보일 때 다시 찾아 지도), 직접 적은 장소(글자만)
    {
      ...ev(1, TEAM_ID, "저녁 약속", d(3), "19:00", d(3), "21:00", OTHER_ID, false, "예약 완료, 4명.\n메뉴 미리 보기: https://place.map.kakao.com/27531028"),
      place: { text: null, query: "카페", kakaoPlaceId: "27531028" },
    },
    ev(2, TEAM_ID, "치과", d(7), "10:30", d(7), "11:30", ME_ID),
    { ...ev(3, TEAM_ID, "영화", today, "19:30", today, "22:00", ME_ID, false, "아이맥스. 7시에 4번 출구에서 보자, 팝콘은 내가 살게."), place: { text: "CGV 용산아이파크몰", query: null, kakaoPlaceId: null } },
    ev(7, TEAM_ID, "원고 마감", today, "00:00", addDays(today, 1), "00:00", OTHER_ID, true),
    ev(4, TEAM_ID, "부모님 댁", addDays(today, 1), "00:00", addDays(today, 2), "00:00", ME_ID, true),
    ev(5, TEAM_ID, "요가", addDays(today, 3), "07:00", addDays(today, 3), "08:00", OTHER_ID),
    ev(6, TEAM_ID, "제주 여행", d(24), "00:00", d(27), "00:00", ME_ID, true, "항공권 예매함"),
    ev(8, PERSONAL_ID, "팀 회의", addDays(today, 2), "14:00", addDays(today, 2), "16:00", ME_ID),
    ev(9, OTHER_PERSONAL_ID, "운동", addDays(today, 4), "18:00", addDays(today, 4), "20:00", OTHER_ID),
    // (#192) 주 보기 확인용: 오늘 저녁 4개 겹침(영화 포함, 3열 넘침 "+N"), 자정을 넘는 일정, 지난 일정 2개
    ev(30, TEAM_ID, "카페 작업", today, "20:00", today, "21:00", OTHER_ID),
    ev(31, TEAM_ID, "엄마랑 통화", today, "20:30", today, "21:30", ME_ID),
    ev(32, TEAM_ID, "동네 산책", today, "20:45", today, "21:15", OTHER_ID),
    ev(33, TEAM_ID, "심야 보드게임", addDays(today, 2), "23:00", addDays(today, 3), "01:30", ME_ID),
    ev(34, TEAM_ID, "독서 모임", addDays(today, -3), "15:00", addDays(today, -3), "17:00", OTHER_ID),
    ev(35, TEAM_ID, "생일 파티", addDays(today, -12), "18:00", addDays(today, -12), "21:00", ME_ID),
    // (#355) 폰 월 달력 이름 칩 확인용: 하루 6개(4개 + "+2"), 긴 제목, 주를 넘는 여러 날(목~일), 일정 색, 다음다음 달(6주 달) 일정
    ev(36, TEAM_ID, "스터디", d(17), "08:00", d(17), "09:00", ME_ID),
    { ...ev(37, TEAM_ID, "택배 받기", d(17), "10:00", d(17), "10:30", OTHER_ID), color: MEMBER_COLORS[2] },
    ev(38, TEAM_ID, "치과 정기검진", d(17), "11:00", d(17), "12:00", ME_ID),
    { ...ev(39, TEAM_ID, "헬스", d(17), "18:00", d(17), "19:00", OTHER_ID), color: MEMBER_COLORS[4] },
    ev(40, TEAM_ID, "독서 모임 준비", d(17), "20:00", d(17), "21:00", ME_ID),
    ev(41, TEAM_ID, "저녁 장보기", d(17), "21:00", d(17), "21:30", OTHER_ID),
    { ...ev(42, TEAM_ID, "강남역 스타벅스에서 분기 회고 겸 팀 회의", d(18), "14:00", d(18), "16:00", ME_ID), color: MEMBER_COLORS[3] },
    { ...ev(43, TEAM_ID, "회사 워크숍 (양평 리조트)", d(19), "00:00", d(23), "00:00", OTHER_ID, true), color: MEMBER_COLORS[7] },
    { ...ev(44, TEAM_ID, "겨울 여행", addDays(today, 58), "00:00", addDays(today, 62), "00:00", ME_ID, true), color: MEMBER_COLORS[6] },
    ev(45, TEAM_ID, "새해 계획 세우기", addDays(today, 50), "10:00", addDays(today, 50), "11:00", OTHER_ID),
    // 반복 일정 (#187): 2주 전 내일 요일부터 매주 19:30~21:00. 다음 주 회차는 "이 일정만" 20:00 으로 옮김
    {
      ...ev(10, TEAM_ID, "같이 요리하기", weeklyStart, "19:30", weeklyStart, "21:00", OTHER_ID, false, "장보기는 번갈아"),
      repeat: "WEEKLY",
      exceptions: [
        { occurrence: addDays(weeklyStart, 21), cancelled: false, startsAt: kstToIso(addDays(weeklyStart, 21), "20:00"), endsAt: kstToIso(addDays(weeklyStart, 21), "21:30") },
      ],
    },
    // 매월 반복, 올해 12월 31일까지
    { ...ev(11, TEAM_ID, "관리비 내기", d(25), "09:00", d(25), "09:30", ME_ID), repeat: "MONTHLY", repeatUntil: keyOf(y, 12, 31) },
    // (#248) 우리 가족: 참여자 표시 확인용. 없으면 모두, 배열이면 그 사람들, 빈 배열이면 참여자 없음
    { ...ev(20, FAMILY_ID, "아이 병원", today, "10:00", today, "11:00", MOM_ID), allMembers: false, participantIds: [DAD_ID] },
    ev(21, FAMILY_ID, "가족 저녁", today, "19:00", today, "21:00", ME_ID, false, "외식, 7시 집 앞"),
    { ...ev(22, FAMILY_ID, "엄마 회식", addDays(today, 1), "19:00", addDays(today, 1), "22:00", MOM_ID), allMembers: false, participantIds: [MOM_ID] },
    { ...ev(23, FAMILY_ID, "장보기", addDays(today, 1), "11:00", addDays(today, 1), "12:00", OTHER_ID), allMembers: false, participantIds: [] },
    { ...ev(24, FAMILY_ID, "피아노 학원", addDays(today, 1), "16:00", addDays(today, 1), "17:00", DAD_ID), allMembers: false, participantIds: [OTHER_ID] },
    { ...ev(25, FAMILY_ID, "헬스", addDays(today, 1), "07:00", addDays(today, 1), "08:00", DAD_ID), allMembers: false, participantIds: [DAD_ID] },
    { ...ev(26, FAMILY_ID, "이사 준비", addDays(today, 2), "00:00", addDays(today, 4), "00:00", ME_ID, true), allMembers: false, participantIds: [ME_ID, OTHER_ID] },
    { ...ev(27, FAMILY_ID, "할머니 댁", addDays(today, 4), "13:00", addDays(today, 4), "18:00", MOM_ID), allMembers: false, participantIds: [MOM_ID, DAD_ID, OTHER_ID] },
    ev(28, FAMILY_ID, "주말 캠핑", addDays(today, 5), "00:00", addDays(today, 8), "00:00", DAD_ID, true, "텐트는 아빠가"),
    { ...ev(29, FAMILY_ID, "엄마 아빠 여행", addDays(today, 9), "00:00", addDays(today, 11), "00:00", DAD_ID, true), allMembers: false, participantIds: [MOM_ID, DAD_ID] },
  ];

  // 기념일 (#107 자동 표시 확인용). n 년 전 같은 월일
  const yearsAgo = (key: string, n: number) => sameDayInYear(key, parseKey(key).y - n);
  const anniversaries: AnniversaryRow[] = [
    // 오늘이 100일 (칸, 상세, 다가오는 일정, D-day 줄 모두 "100일 오늘")
    {
      id: 1,
      groupId: TEAM_ID,
      name: "처음 만난 날",
      date: addDays(today, -99),
      kind: "COUNT_UP",
      creatorId: OTHER_ID,
      createdAt: hoursAgo(24 * 30),
    },
    // 매년 반복: 사흘 뒤가 생일
    {
      id: 2,
      groupId: TEAM_ID,
      name: "하늘 생일",
      date: yearsAgo(addDays(today, 3), 29),
      kind: "YEARLY",
      reminders: ["DAY_OF", "DAY_BEFORE"],
      creatorId: ME_ID,
      createdAt: hoursAgo(24 * 20),
    },
    // 닷새 뒤 3주년
    {
      id: 3,
      groupId: TEAM_ID,
      name: "결혼기념일",
      date: yearsAgo(addDays(today, 5), 3),
      kind: "COUNT_UP",
      creatorId: ME_ID,
      createdAt: hoursAgo(24 * 15),
    },
    // 그날만
    {
      id: 4,
      groupId: TEAM_ID,
      name: "자격증 시험",
      date: addDays(today, 12),
      kind: "ONCE",
      reminders: [],
      creatorId: ME_ID,
      createdAt: hoursAgo(24 * 10),
    },
  ];

  // 새 소식 2개 (하늘이 추가/수정). 내 lastSeenAt(20시간 전) 이후라 isNew
  const logs: EventLogRow[] = [
    {
      id: 1,
      groupId: TEAM_ID,
      action: "CREATED",
      eventId: 7,
      title: "원고 마감",
      startsAt: kstToIso(today),
      endsAt: kstToIso(addDays(today, 1)),
      allDay: true,
      repeat: null,
      scope: null,
      occurrence: null,
      actorId: OTHER_ID,
      createdAt: hoursAgo(3),
    },
    {
      id: 2,
      groupId: TEAM_ID,
      action: "UPDATED",
      eventId: 1,
      title: "저녁 약속",
      startsAt: kstToIso(d(3), "19:00"),
      endsAt: kstToIso(d(3), "21:00"),
      allDay: false,
      repeat: null,
      scope: null,
      occurrence: null,
      actorId: OTHER_ID,
      createdAt: hoursAgo(10),
    },
    // 반복 일정 기록 (#187): 추가 1건, "이 일정만" 수정 1건
    {
      id: 3,
      groupId: TEAM_ID,
      action: "UPDATED",
      eventId: 10,
      title: "같이 요리하기",
      startsAt: kstToIso(addDays(weeklyStart, 21), "20:00"),
      endsAt: kstToIso(addDays(weeklyStart, 21), "21:30"),
      allDay: false,
      repeat: "WEEKLY",
      scope: "THIS",
      occurrence: addDays(weeklyStart, 21),
      actorId: OTHER_ID,
      createdAt: hoursAgo(12),
    },
    {
      id: 4,
      groupId: TEAM_ID,
      action: "CREATED",
      eventId: 10,
      title: "같이 요리하기",
      startsAt: kstToIso(weeklyStart, "19:30"),
      endsAt: kstToIso(weeklyStart, "21:00"),
      allDay: false,
      repeat: "WEEKLY",
      scope: null,
      occurrence: null,
      actorId: OTHER_ID,
      createdAt: hoursAgo(24 * 13),
    },
  ];

  // (#191) 팀 활동 3개: 하늘의 기념일 날짜 변경(새 소식), 팀 이름 변경, 하늘 합류(지난 것)
  const activities: ActivityRow[] = [
    {
      id: 1,
      groupId: TEAM_ID,
      type: "ANNIVERSARY_UPDATED",
      actorId: OTHER_ID,
      actorName: "하늘",
      anniversaryId: anniversaries[0]?.id ?? null,
      payload: {
        name: anniversaries[0]?.name ?? "처음 만난 날",
        date: anniversaries[0]?.date ?? today,
        kind: anniversaries[0]?.kind ?? "COUNT_UP",
        changed: ["date"],
        before: { date: addDays(anniversaries[0]?.date ?? today, -1) },
      },
      createdAt: hoursAgo(5),
    },
    {
      id: 2,
      groupId: TEAM_ID,
      type: "GROUP_RENAMED",
      actorId: OTHER_ID,
      actorName: "하늘",
      anniversaryId: null,
      payload: { from: "우리", to: "우리 둘" },
      createdAt: hoursAgo(24 * 2),
    },
    {
      id: 3,
      groupId: TEAM_ID,
      type: "MEMBER_JOINED",
      actorId: OTHER_ID,
      actorName: "하늘",
      anniversaryId: null,
      payload: {},
      createdAt: hoursAgo(24 * 20),
    },
  ];

  // (#276) 할 일: 우리 둘 팀에 목록 둘(장보기는 체크 섞임, 여행 준비물은 다 함), 내 달력(개인)은 비어 있다(빈 상태 확인)
  const todoLists: TodoListRow[] = [
    { id: 1, groupId: TEAM_ID, name: "장보기", creatorId: ME_ID, editorId: OTHER_ID, createdAt: hoursAgo(48), updatedAt: hoursAgo(1) },
    { id: 2, groupId: TEAM_ID, name: "제주 여행 준비물", creatorId: OTHER_ID, editorId: ME_ID, createdAt: hoursAgo(24 * 6), updatedAt: hoursAgo(26) },
  ];
  const todo = (id: number, listId: number, text: string, creatorId: number, createdH: number, doneBy: number | null = null, doneH = 0): TodoItemRow => ({
    id,
    listId,
    text,
    done: doneBy !== null,
    doneAt: doneBy !== null ? hoursAgo(doneH) : null,
    doneById: doneBy,
    creatorId,
    createdAt: hoursAgo(createdH),
    updatedAt: hoursAgo(doneBy !== null ? doneH : createdH),
  });
  const todoItems: TodoItemRow[] = [
    todo(1, 1, "우유 2개", ME_ID, 40),
    todo(2, 1, "계란 한 판", OTHER_ID, 39),
    todo(3, 1, "대파", OTHER_ID, 30, OTHER_ID, 1),
    todo(4, 1, "식빵", ME_ID, 20),
    todo(5, 1, "세제 (리필용으로 큰 거, 향 없는 것)", OTHER_ID, 10, ME_ID, 3),
    todo(6, 2, "여권", OTHER_ID, 140, ME_ID, 30),
    todo(7, 2, "충전기", ME_ID, 120, ME_ID, 26),
  ];

  // (#190) 참석 여부와 반응: 가족 저녁(모두)은 엄마 참석, 아빠 미정, 하늘 반응. 할머니 댁은 내가 참여자가 아니다(세그먼트 없음).
  // 우리 둘은 영화, 부모님 댁에 내가 참석. 나머지 앞으로의 일정은 "응답" 표시가 붙는다
  const seen = (id: number) => {
    const e = events.find((x) => x.id === id)!;
    return { seenStartsAt: e.startsAt, seenEndsAt: e.endsAt, occurrence: dateKeyOf(e.startsAt) };
  };
  const rsvps: RsvpRow[] = [
    { eventId: 21, userId: MOM_ID, status: "GOING", updatedAt: hoursAgo(3), ...seen(21) },
    { eventId: 21, userId: DAD_ID, status: "MAYBE", updatedAt: hoursAgo(2), ...seen(21) },
    { eventId: 27, userId: MOM_ID, status: "GOING", updatedAt: hoursAgo(5), ...seen(27) },
    { eventId: 3, userId: ME_ID, status: "GOING", updatedAt: hoursAgo(6), ...seen(3) },
    { eventId: 3, userId: OTHER_ID, status: "GOING", updatedAt: hoursAgo(4), ...seen(3) },
    { eventId: 4, userId: ME_ID, status: "GOING", updatedAt: hoursAgo(6), ...seen(4) },
  ];
  const reactions: ReactionRow[] = [
    { eventId: 21, userId: OTHER_ID, kind: "LIKE", occurrence: seen(21).occurrence },
    { eventId: 21, userId: MOM_ID, kind: "EXCITED", occurrence: seen(21).occurrence },
  ];
  const familyDinner = events.find((x) => x.id === 21)!;
  activities.push({
    id: 4,
    groupId: FAMILY_ID,
    type: "EVENT_RSVP",
    actorId: DAD_ID,
    actorName: "아빠",
    anniversaryId: null,
    payload: {
      eventId: 21,
      eventCode: mockEventCode(21),
      occurrence: null,
      title: familyDinner.title,
      startsAt: familyDinner.startsAt,
      endsAt: familyDinner.endsAt,
      allDay: false,
      status: "MAYBE",
    },
    createdAt: hoursAgo(2),
  });

  // (#189) 우리 가족 팀에 진행 중 약속 투표 하나 (엄마가 열고 엄마, 아빠가 답함, 마감 내일). 홈 "정하는 중" 과 새 소식 확인용
  const polls: PollRow[] = [
    {
      id: 1,
      groupId: FAMILY_ID,
      title: "주말 가족 외식",
      status: "OPEN",
      deadline: kstToIso(addDays(today, 1), "21:00"),
      allMembers: true,
      participantIds: [],
      creatorId: MOM_ID,
      eventId: null,
      decidedOptionId: null,
      createdAt: hoursAgo(3),
      closedAt: null,
      options: [
        { id: 1, startsAt: kstToIso(addDays(today, 3), "12:00"), endsAt: kstToIso(addDays(today, 3), "14:00"), allDay: false, voterIds: [MOM_ID, DAD_ID] },
        { id: 2, startsAt: kstToIso(addDays(today, 3), "18:00"), endsAt: kstToIso(addDays(today, 3), "20:00"), allDay: false, voterIds: [MOM_ID] },
        { id: 3, startsAt: kstToIso(addDays(today, 4), "12:00"), endsAt: kstToIso(addDays(today, 4), "14:00"), allDay: false, voterIds: [DAD_ID] },
      ],
    },
  ];
  activities.push({
    id: 5,
    groupId: FAMILY_ID,
    type: "POLL_CREATED",
    actorId: MOM_ID,
    actorName: "엄마",
    anniversaryId: null,
    payload: { pollId: 1, code: mockPollCode(1), title: "주말 가족 외식" },
    createdAt: hoursAgo(3),
  });

  // (#515) 관리자 사용자 목록용: 팀이 없는 가입자 몇 명
  users.push(
    // (#528) 민지는 공지, 팀원 변경 알림을 껐다 (관리자 사용자 상세의 알림 설정)
    {
      id: 11,
      nickname: "민지",
      profileImageUrl: null,
      createdAt: hoursAgo(24 * 12),
      providers: ["APPLE"],
      notify: { reminder: true, change: false, anniversary: true, join: true, weekly: true, weeklyNudge: false, poll: true, notice: false },
    },
    { id: 12, nickname: "수경", profileImageUrl: null, createdAt: hoursAgo(24 * 6), providers: ["EMAIL"] },
    // (#528) 도윤은 앱으로 로그인했지만 알림을 허용하지 않아 기종을 모른다
    { id: 13, nickname: "도윤", profileImageUrl: null, createdAt: hoursAgo(24 * 2), providers: ["KAKAO", "APPLE"], lastAppLoginAt: hoursAgo(30) },
  );

  // (#515) 공지: 고정 업데이트, 점검 안내(게시), 초안 하나. 나는 공지를 본 적이 없어 새 공지 점이 보인다
  const notices: NoticeRow[] = [
    {
      id: 1,
      title: "볼까가 일정을 고치고 지울 수 있어요",
      body: "이제 볼까에게 \"금요일 회식 7시 반으로 바꿔줘\" 처럼 말하면 바꿀 일정을 찾아 확인 카드로 보여 드려요.\n지우기도 같은 방법으로 할 수 있어요.\n\n자세한 사용법은 https://whenwemeet.day/support 에 정리해 두었어요.",
      kind: "update",
      pinned: true,
      publishedAt: hoursAgo(24 * 3),
      // (#528) 이 공지는 푸시로도 보냈다
      pushedAt: hoursAgo(24 * 3),
      createdAt: hoursAgo(24 * 3),
      updatedAt: hoursAgo(24 * 3),
    },
    {
      id: 2,
      title: "11월 30일 새벽 서버 점검 안내",
      body: "11월 30일(일) 새벽 2시부터 4시까지 서버를 점검해요.\n\n점검 중에는 달력을 열 수 없어요. 이용에 불편을 드려 죄송해요.",
      kind: "maintenance",
      pinned: false,
      publishedAt: hoursAgo(20),
      pushedAt: null,
      createdAt: hoursAgo(20),
      updatedAt: hoursAgo(20),
    },
    {
      id: 3,
      title: "연말 일정 정리 기능 (초안)",
      body: "아직 쓰는 중인 공지예요.",
      kind: "notice",
      pinned: false,
      publishedAt: null,
      pushedAt: null,
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(2),
    },
  ];

  // (#528) 관리자 팀 목록의 개인 달력: 가입자마다 "내 달력" 하나 (실서비스처럼 같은 이름이 늘어선다). 엄마, 아빠도
  for (const [i, userId] of [MOM_ID, DAD_ID, 11, 12, 13].entries()) {
    const id = 60 + i;
    const at = users.find((u) => u.id === userId)!.createdAt;
    groups.push({ id, type: "PERSONAL", name: "내 달력", inviteCode: null, createdAt: at });
    memberships.push({ userId, groupId: id, color: "#9CA3AF", displayName: null, joinedAt: at, lastSeenAt: null });
  }

  // (#528) 관리자 사용자 상세의 기기: 민지는 아이폰과 안드로이드 태블릿, 수경은 아이폰 하나. 토큰은 목 안에서만 쓴다
  const pushDevices: PushDeviceRow[] = [
    { token: "ExponentPushToken[mock-minji-ios]", userId: 11, platform: "IOS", appVersion: "1.3.0", createdAt: hoursAgo(24 * 10), lastSeenAt: hoursAgo(3) },
    { token: "ExponentPushToken[mock-minji-android]", userId: 11, platform: "ANDROID", appVersion: "1.2.1", createdAt: hoursAgo(24 * 9), lastSeenAt: hoursAgo(24 * 4) },
    { token: "ExponentPushToken[mock-sugyeong-ios]", userId: 12, platform: "IOS", appVersion: "1.3.0", createdAt: hoursAgo(24 * 5), lastSeenAt: hoursAgo(26) },
  ];

  return { users, groups, memberships, events, anniversaries, logs, activities, todoLists, todoItems, rsvps, reactions, polls, notices, pushDevices, adminLogs: [], seq: 100 };
}

/** 응답용 member 객체 (api.md 공통 표시 이름 규칙) */
export function memberOf(store: Store, groupId: number, userId: number | null): Member {
  if (userId === null) {
    return { userId: null, displayName: "탈퇴한 멤버", color: "#9CA3AF", profileImageUrl: null };
  }
  const user = store.users.find((u) => u.id === userId);
  const ms = store.memberships.find((x) => x.userId === userId && x.groupId === groupId);
  if (!user) {
    return { userId: null, displayName: "탈퇴한 멤버", color: "#9CA3AF", profileImageUrl: null };
  }
  return {
    userId,
    displayName: ms?.displayName ?? user.nickname,
    color: ms?.color ?? "#9CA3AF",
    profileImageUrl: user.profileImageUrl,
    joinedAt: ms?.joinedAt,
  };
}
