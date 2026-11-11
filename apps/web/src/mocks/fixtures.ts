// API_MOCK=1 일 때 쓰는 메모리 픽스처. 백엔드가 없을 때 화면 확인용.
// 날짜는 실행 시점의 KST 이번 달 기준으로 만든다.
import { sameDayInYear } from "@/lib/anniversary";
import {
  addDays,
  keyOf,
  kstToIso,
  parseKey,
  todayKey,
  toKst,
} from "@/lib/date";
import type { AnniversaryKind, GroupType, Member, Repeat } from "@/lib/types";
import type { MockException } from "./recurrence";

export type UserRow = {
  id: number;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: string;
};
export type GroupRow = {
  id: number;
  type: GroupType;
  name: string;
  inviteCode: string | null;
  createdAt: string;
};
export type MembershipRow = {
  userId: number;
  groupId: number;
  color: string;
  displayName: string | null;
  joinedAt: string;
  lastSeenAt: string | null;
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
};
export type AnniversaryRow = {
  id: number;
  groupId: number;
  name: string;
  date: string;
  kind: AnniversaryKind;
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

export type Store = {
  users: UserRow[];
  groups: GroupRow[];
  memberships: MembershipRow[];
  events: EventRow[];
  anniversaries: AnniversaryRow[];
  logs: EventLogRow[];
  seq: number;
};

export const ME_ID = 1;
export const OTHER_ID = 2;
export const PERSONAL_ID = 1;
export const TEAM_ID = 2;
const OTHER_PERSONAL_ID = 3;
export const TEAM_INVITE_CODE = "WM7K2Q";

const WEB_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:3000";
export const inviteUrlOf = (code: string) => `${WEB_ORIGIN}/join/${code}`;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export function buildStore(): Store {
  const today = todayKey();
  const { y, m } = toKst(Date.now());
  const d = (day: number) => keyOf(y, m, Math.min(day, 28));

  const users: UserRow[] = [
    { id: ME_ID, nickname: "지우", profileImageUrl: null, createdAt: hoursAgo(24 * 40) },
    { id: OTHER_ID, nickname: "하늘", profileImageUrl: null, createdAt: hoursAgo(24 * 38) },
  ];

  const groups: GroupRow[] = [
    { id: PERSONAL_ID, type: "PERSONAL", name: "내 달력", inviteCode: null, createdAt: hoursAgo(24 * 40) },
    { id: TEAM_ID, type: "TEAM", name: "우리 둘", inviteCode: TEAM_INVITE_CODE, createdAt: hoursAgo(24 * 38) },
    { id: OTHER_PERSONAL_ID, type: "PERSONAL", name: "내 달력", inviteCode: null, createdAt: hoursAgo(24 * 38) },
  ];

  const memberships: MembershipRow[] = [
    { userId: ME_ID, groupId: PERSONAL_ID, color: "#F26D6D", displayName: null, joinedAt: hoursAgo(24 * 40), lastSeenAt: hoursAgo(24 * 2) },
    { userId: ME_ID, groupId: TEAM_ID, color: "#F26D6D", displayName: null, joinedAt: hoursAgo(24 * 38), lastSeenAt: hoursAgo(20) },
    { userId: OTHER_ID, groupId: TEAM_ID, color: "#F2994A", displayName: null, joinedAt: hoursAgo(24 * 37), lastSeenAt: hoursAgo(1) },
    { userId: OTHER_ID, groupId: OTHER_PERSONAL_ID, color: "#F2994A", displayName: null, joinedAt: hoursAgo(24 * 38), lastSeenAt: null },
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
    ev(1, TEAM_ID, "저녁 약속", d(3), "19:00", d(3), "21:00", OTHER_ID, false, "성수동, 예약 완료"),
    ev(2, TEAM_ID, "치과", d(7), "10:30", d(7), "11:30", ME_ID),
    ev(3, TEAM_ID, "영화", today, "19:30", today, "22:00", ME_ID, false, "CGV 용산 아이맥스. 7시에 4번 출구에서 보자, 팝콘은 내가 살게."),
    ev(7, TEAM_ID, "원고 마감", today, "00:00", addDays(today, 1), "00:00", OTHER_ID, true),
    ev(4, TEAM_ID, "부모님 댁", addDays(today, 1), "00:00", addDays(today, 2), "00:00", ME_ID, true),
    ev(5, TEAM_ID, "요가", addDays(today, 3), "07:00", addDays(today, 3), "08:00", OTHER_ID),
    ev(6, TEAM_ID, "제주 여행", d(24), "00:00", d(27), "00:00", ME_ID, true, "항공권 예매함"),
    ev(8, PERSONAL_ID, "팀 회의", addDays(today, 2), "14:00", addDays(today, 2), "16:00", ME_ID),
    ev(9, OTHER_PERSONAL_ID, "운동", addDays(today, 4), "18:00", addDays(today, 4), "20:00", OTHER_ID),
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

  return { users, groups, memberships, events, anniversaries, logs, seq: 100 };
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
