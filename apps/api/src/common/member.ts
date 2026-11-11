import { FILE_LOCATION_SELECT, type FileLocation, type FileUrlBuilder } from '../files/file-url.builder.js';

/** 합류 시 자동 배정하는 멤버 색 팔레트 (api.md 2.2) */
export const MEMBER_COLORS = [
  '#F26D6D',
  '#F2994A',
  '#F2C94C',
  '#6FCF97',
  '#56CCF2',
  '#5B6CF4',
  '#A66CF4',
  '#F279B5',
] as const;

/** 응답의 사람 정보 공통 모양 */
export interface Member {
  userId: number | null;
  displayName: string;
  color: string;
  profileImageUrl: string | null;
}

export interface MemberWithJoin extends Member {
  userId: number;
  joinedAt: Date;
}

/** 탈퇴한 사용자 (FK SetNull 로 creatorId/actorId 가 null) */
export const DELETED_MEMBER: Member = Object.freeze({
  userId: null,
  displayName: '탈퇴한 멤버',
  color: '#9CA3AF',
  profileImageUrl: null,
});

/** 팀을 나갔지만 탈퇴하지는 않은 사람의 색 (멤버십이 없어 팔레트 색이 없다) */
const LEFT_MEMBER_COLOR = '#9CA3AF';

export interface MembershipRow {
  userId: number;
  color: string;
  displayName: string | null;
  joinedAt: Date;
  user: { nickname: string; profileImageUrl: string | null };
}

export interface UserRow {
  nickname: string;
  profileImageUrl: string | null;
}

/**
 * 사람 정보가 필요한 조회의 User select. 사진은 File 의 provider/key 로 읽고 URL 은 FileUrlBuilder 가 만든다 (결정기록 D-38, D-56).
 * Repository 는 이 모양으로 읽고 `toUserRow` 로 `{ nickname, profileImageUrl }` 로 바꿔 돌려준다 (응답 계약 유지)
 */
export const USER_PUBLIC_SELECT = { select: { nickname: true, avatar: { select: FILE_LOCATION_SELECT } } } as const;

/** USER_PUBLIC_SELECT 로 읽은 행 */
export interface UserPublicRecord {
  nickname: string;
  avatar: FileLocation | null;
}

export function toUserRow(user: UserPublicRecord, urls: FileUrlBuilder): UserRow {
  return { nickname: user.nickname, profileImageUrl: urls.publicUrlOrNull(user.avatar) };
}

/** 탈퇴자(FK SetNull) 를 그대로 null 로 넘기는 판 */
export function toUserRowOrNull(user: UserPublicRecord | null, urls: FileUrlBuilder): UserRow | null {
  return user ? toUserRow(user, urls) : null;
}

/** Membership + User → Member. displayName = Membership.displayName ?? User.nickname */
export function toMember(row: MembershipRow): MemberWithJoin {
  return {
    userId: row.userId,
    displayName: row.displayName ?? row.user.nickname,
    color: row.color,
    profileImageUrl: row.user.profileImageUrl,
    joinedAt: row.joinedAt,
  };
}

/** 팀 멤버십 목록으로 creatorId/actorId, 일정 참여자(#248)를 Member 로 바꾸는 해석기 */
export class MemberResolver {
  private readonly byUserId = new Map<number, Member>();

  constructor(memberships: MembershipRow[]) {
    for (const row of memberships) {
      const { joinedAt: _joinedAt, ...member } = toMember(row);
      this.byUserId.set(row.userId, member);
    }
  }

  /** (#248) 지금 멤버 전원. 생성자에 넘긴 순서 그대로 (resolverFor 는 가입순으로 읽는다) */
  all(): Member[] {
    return [...this.byUserId.values()];
  }

  /**
   * - userId null → 탈퇴한 멤버
   * - 현재 멤버 → 팀 안의 색/표시 이름
   * - 팀을 나간 사용자 → 닉네임은 유지, 색은 회색
   */
  resolve(userId: number | null, user: UserRow | null): Member {
    if (userId === null || user === null) return DELETED_MEMBER;
    const member = this.byUserId.get(userId);
    if (member) return member;
    return { userId, displayName: user.nickname, color: LEFT_MEMBER_COLOR, profileImageUrl: user.profileImageUrl };
  }
}

/**
 * 새로 배정하는 색 후보: 팔레트 앞 7개. 화면은 멤버 색을 7개로 그리므로(디자인토큰.md "2026-11 확정", D-57)
 * 8번째 키(#F279B5)를 새로 주지 않는다. 이미 그 값을 가진 멤버는 그대로 둔다 (화면이 따로 매핑)
 */
export const ASSIGNABLE_COLORS = MEMBER_COLORS.slice(0, 7);

/** 팀에서 가장 적게 쓰인 색(앞 7개 중). 동률이면 팔레트 순서 (결정기록 D-21) */
export function pickLeastUsedColor(usedColors: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const color of usedColors) counts.set(color.toUpperCase(), (counts.get(color.toUpperCase()) ?? 0) + 1);
  let best: string = ASSIGNABLE_COLORS[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of ASSIGNABLE_COLORS) {
    const count = counts.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}
