import { deriveKey } from '../email-login/email-crypto.js';
import {
  INVITE_MARKER_KEY_INFO,
  inviteMarker,
  matchInviteMarker,
} from './invite-marker.js';

describe('invite-marker (#196, D-157)', () => {
  const key = deriveKey(
    'unit-secret-0123456789abcdef0123456789abcdef',
    INVITE_MARKER_KEY_INFO,
  );
  const other = deriveKey(
    'another-secret-0123456789abcdef0123456789ab',
    INVITE_MARKER_KEY_INFO,
  );

  it('10자 base64url, 결정적, 사용자 id 를 싣지 않는다', () => {
    const m = inviteMarker(key, 10, 12345);
    expect(m).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(inviteMarker(key, 10, 12345)).toBe(m);
    expect(m).not.toContain('12345');
  });

  it('팀, 사용자, 비밀이 다르면 값이 다르다', () => {
    const m = inviteMarker(key, 10, 1);
    expect(inviteMarker(key, 11, 1)).not.toBe(m);
    expect(inviteMarker(key, 10, 2)).not.toBe(m);
    expect(inviteMarker(other, 10, 1)).not.toBe(m);
    // 이메일 로그인 키와 같은 비밀이어도 info 가 달라 키가 다르다
    expect(
      deriveKey('s'.repeat(40), INVITE_MARKER_KEY_INFO).equals(
        deriveKey('s'.repeat(40), 'wwm-email-code'),
      ),
    ).toBe(false);
  });

  it('matchInviteMarker: 맞는 멤버 id, 아니면 null. 형식 오류도 null', () => {
    const ids = [1, 2, 3];
    expect(matchInviteMarker(key, 10, ids, inviteMarker(key, 10, 2))).toBe(2);
    expect(
      matchInviteMarker(key, 10, ids, inviteMarker(key, 10, 4)),
    ).toBeNull();
    expect(
      matchInviteMarker(key, 10, ids, inviteMarker(key, 11, 2)),
    ).toBeNull();
    expect(matchInviteMarker(key, 10, [], inviteMarker(key, 10, 2))).toBeNull();
    for (const bad of [
      undefined,
      null,
      7,
      '',
      'abc',
      'a'.repeat(11),
      '한글한글한글한글한글',
      'abc+/abc==',
      ['x'],
    ]) {
      expect(matchInviteMarker(key, 10, ids, bad)).toBeNull();
    }
  });
});
