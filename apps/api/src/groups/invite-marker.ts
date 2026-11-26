import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * (#196) 초대 링크의 "보낸 사람 표식" (`?by=`, D-157). 모두 순수 함수, 키는 MembershipService 가 JWT_SECRET 에서 파생해 넘긴다.
 * 표식 = base64url(HMAC-SHA256(key, "<groupId>:<userId>")) 앞 10자. 사용자 id 를 싣지 않고 팀마다 값이 다르다
 */

/** HKDF info. 이메일 로그인 키(D-112)와 같은 비밀에서 나눠 만든다 */
export const INVITE_MARKER_KEY_INFO = 'wwm-invite-by';
/** 10자 = 60비트 */
const MARKER_LENGTH = 10;
const MARKER_PATTERN = /^[A-Za-z0-9_-]{10}$/;

export function inviteMarker(
  key: Buffer,
  groupId: number,
  userId: number,
): string {
  return createHmac('sha256', key)
    .update(`${groupId}:${userId}`, 'utf8')
    .digest('base64url')
    .slice(0, MARKER_LENGTH);
}

/**
 * by 와 맞는 멤버의 userId. 형식이 틀리거나 아무와도 맞지 않으면 null (오류 아님).
 * 멤버 전원을 끝까지 비교해 몇 번째에서 맞았는지가 시간으로 드러나지 않게 한다
 */
export function matchInviteMarker(
  key: Buffer,
  groupId: number,
  userIds: readonly number[],
  by: unknown,
): number | null {
  if (typeof by !== 'string' || !MARKER_PATTERN.test(by)) return null;
  const given = Buffer.from(by, 'utf8');
  let found: number | null = null;
  for (const userId of userIds) {
    if (
      timingSafeEqual(
        Buffer.from(inviteMarker(key, groupId, userId), 'utf8'),
        given,
      ) &&
      found === null
    )
      found = userId;
  }
  return found;
}
