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

/** 팀 멤버십 목록으로 creatorId/actorId 를 Member 로 바꾸는 해석기 */
export class MemberResolver {
  private readonly byUserId = new Map<number, Member>();

  constructor(memberships: MembershipRow[]) {
    for (const row of memberships) {
      const { joinedAt: _joinedAt, ...member } = toMember(row);
      this.byUserId.set(row.userId, member);
    }
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

/** 팀에서 가장 적게 쓰인 팔레트 색. 동률이면 팔레트 순서 (결정기록 D-21) */
export function pickLeastUsedColor(usedColors: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const color of usedColors) counts.set(color.toUpperCase(), (counts.get(color.toUpperCase()) ?? 0) + 1);
  let best: string = MEMBER_COLORS[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of MEMBER_COLORS) {
    const count = counts.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}
