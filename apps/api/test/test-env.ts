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
  // 앱 네이티브 로그인의 app_id 대조값 (access_token_info 는 목)
  process.env.KAKAO_APP_ID = '424242';
  // 애플은 키를 테스트가 직접 만들어 넣는다 (apple.e2e-spec). 로컬 .env 의 실제 값이 섞이지 않게 비운다
  for (const key of ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_BUNDLE_ID', 'APPLE_SERVICE_ID', 'APPLE_REDIRECT_URI']) process.env[key] = '';
  // 실제 R2 로 올라가지 않도록 저장소는 항상 미설정. 업로드 검증은 MemoryStorage 를 주입한다.
  // delete 하면 ConfigModule 이 로컬 .env 의 R2 키를 다시 채우므로 빈 문자열로 덮는다 (dotenv 는 이미 있는 변수를 덮지 않음)
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']) process.env[key] = '';
  // (#188) 푸시 틱 인터벌은 끄고(테스트가 tick(now) 를 직접 부른다), 실제 Expo 로 나가지 않게 닫힌 로컬 포트를 기본값으로.
  // 푸시 e2e 는 가짜 Expo 서버 주소를 EXPO_PUSH_URL 에 넣고 앱을 만든다
  process.env.PUSH_ENABLED = '';
  process.env.EXPO_ACCESS_TOKEN = '';
  process.env.EXPO_PUSH_URL = 'http://127.0.0.1:9/--/api/v2/push';
  // (#245) 이메일 로그인은 켜고 내부 키를 맞춘다. 실제 Resend 로 나가지 않게 키는 비우고 주소는 닫힌 로컬 포트.
  // 이메일 e2e 는 MAIL_CLIENT 를 가짜로 바꿔 메일에서 링크와 코드를 꺼낸다. 심사 계정 값도 가짜
  process.env.EMAIL_LOGIN_ENABLED = '1';
  process.env.INTERNAL_API_KEY = 'e2e-internal-key';
  process.env.RESEND_API_KEY = '';
  process.env.RESEND_API_URL = 'http://127.0.0.1:9';
  process.env.REVIEW_EMAIL = 'review@e2e.example';
  process.env.REVIEW_CODE = '246810';
  // (#199) 장소 검색은 가짜 공급자 (실제 카카오로 나가지 않게 키를 비운다)
  process.env.KAKAO_REST_API_KEY = '';
  process.env.PLACE_SEARCH_FAKE = '';
  return url;
}
