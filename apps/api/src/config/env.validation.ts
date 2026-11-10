import { R2_ENV_KEYS } from '../storage/storage.service.js';

/**
 * 운영(NODE_ENV=production) 에서 반드시 있어야 하는 환경 변수 (#50, docs/운영/배포.md).
 * 로컬/테스트는 카카오, R2 없이도 뜨도록(결정기록 D-29, #32) 검사하지 않는다
 */
export const REQUIRED_PRODUCTION_ENV = [
  'DATABASE_URL',
  'WEB_ORIGIN',
  'JWT_SECRET',
  'KAKAO_CLIENT_ID',
  'KAKAO_CLIENT_SECRET',
  'KAKAO_REDIRECT_URI',
  'KAKAO_ADMIN_KEY',
  ...R2_ENV_KEYS,
] as const;

/** HS256 키 최소 길이. `openssl rand -base64 48` 은 64자 */
export const MIN_JWT_SECRET_LENGTH = 32;

/** https 로 시작하는 절대 URL 이어야 하는 변수. 운영 쿠키가 Secure 라 http 면 로그인이 깨진다 */
const HTTPS_ENV = [
  'WEB_ORIGIN',
  'KAKAO_REDIRECT_URI',
  'R2_PUBLIC_BASE_URL',
] as const;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * main.ts 의 bootstrap 용. 운영이면 빠진 값을 모아 한 번에 던져 기동을 멈춘다 (값은 메시지에 싣지 않음).
 * 운영이 아니면 그대로 돌려준다
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.NODE_ENV !== 'production') return config;

  const problems: string[] = [];
  const missing = REQUIRED_PRODUCTION_ENV.filter((key) => !text(config[key]));
  if (missing.length > 0) problems.push(`없음: ${missing.join(', ')}`);

  const secret = text(config.JWT_SECRET);
  if (secret && secret.length < MIN_JWT_SECRET_LENGTH)
    problems.push(`JWT_SECRET 은 ${MIN_JWT_SECRET_LENGTH}자 이상`);

  const notHttps = HTTPS_ENV.filter(
    (key) => text(config[key]) && !text(config[key]).startsWith('https://'),
  );
  if (notHttps.length > 0)
    problems.push(`https:// 로 시작해야 함: ${notHttps.join(', ')}`);

  const origin = text(config.WEB_ORIGIN);
  if (origin.endsWith('/')) problems.push('WEB_ORIGIN 끝에 / 를 붙이지 않음');

  if (problems.length > 0)
    throw new Error(`운영 환경 변수 오류 — ${problems.join(' / ')}`);
  return config;
}
