/**
 * mariadb 드라이버 기본값 보정 (#206).
 *
 * MySQL 8.4 기본 인증(caching_sha2_password) 은 재시작하면 인증 캐시를 비운다.
 * TLS 없는 TCP 연결에서 캐시가 비면 서버 공개키로 비밀번호를 보내야 하는데,
 * `allowPublicKeyRetrieval` 이 꺼져 있으면 새 연결을 하나도 못 만들어 API 가 DB 재시작 뒤 회복하지 못한다.
 * Railway 사설망은 이미 암호화돼 있어 공개키 조회를 켠다. URL 에 값이 있으면 그 값을 존중한다.
 */
export function withDriverDefaults(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('allowPublicKeyRetrieval')) {
    url.searchParams.set('allowPublicKeyRetrieval', 'true');
  }
  return url.toString();
}
