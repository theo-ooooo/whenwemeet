import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

/** e2e 가 쓰는 DB. .env 의 TEST_DATABASE_URL, 없으면 로컬 개발 MySQL 의 테스트 DB */
export const FALLBACK_TEST_DATABASE_URL = 'mysql://wwm:wwmpw@127.0.0.1:3307/whenwemeet_test';

/** apps/api/.env 를 읽고 DATABASE_URL 을 테스트 DB 로 바꾼다. setup 과 globalSetup 양쪽에서 부른다 */
export function applyTestEnv(): string {
  loadDotenv({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  const url = process.env.TEST_DATABASE_URL || FALLBACK_TEST_DATABASE_URL;
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV ??= 'test';
  process.env.WEB_ORIGIN ??= 'http://localhost:3000';
  process.env.JWT_SECRET ??= 'e2e-only-secret-0123456789abcdef0123456789abcdef';
  process.env.JWT_EXPIRES_IN ??= '30d';
  // 카카오는 fetch 를 목으로 잡아 검증하므로 설정이 있는 상태로 고정 (값은 가짜)
  process.env.KAKAO_CLIENT_ID = 'e2e-kakao-client-id';
  process.env.KAKAO_CLIENT_SECRET = 'e2e-kakao-client-secret';
  process.env.KAKAO_ADMIN_KEY = 'e2e-kakao-admin-key';
  process.env.KAKAO_REDIRECT_URI = 'http://localhost:4000/v1/auth/kakao/callback';
  // 실제 R2 로 올라가지 않도록 저장소는 항상 미설정. 업로드 검증은 MemoryStorage 를 주입한다.
  // delete 하면 ConfigModule 이 로컬 .env 의 R2 키를 다시 채우므로 빈 문자열로 덮는다 (dotenv 는 이미 있는 변수를 덮지 않음)
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']) process.env[key] = '';
  return url;
}
