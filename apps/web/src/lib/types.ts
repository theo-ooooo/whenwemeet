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

export type EventInput = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  memo?: string;
};

export type Event = EventInput & {
  id: number;
  groupId: number;
  creator: Member;
  createdAt: string;
  updatedAt: string;
};

export type Anniversary = {
  id: number;
  groupId: number;
  name: string;
  date: string; // YYYY-MM-DD (KST)
  creator: Member;
  createdAt: string;
};

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
