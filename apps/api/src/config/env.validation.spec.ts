import {
  MIN_JWT_SECRET_LENGTH,
  REQUIRED_PRODUCTION_ENV,
  validateEnv,
} from './env.validation.js';

/** 운영 필수값이 모두 채워진 설정 (값은 가짜) */
function productionEnv(): Record<string, unknown> {
  const env: Record<string, unknown> = { NODE_ENV: 'production' };
  for (const key of REQUIRED_PRODUCTION_ENV) env[key] = `fake-${key}`;
  env.WEB_ORIGIN = 'https://whenwemeet.day';
  env.KAKAO_REDIRECT_URI = 'https://api.whenwemeet.day/v1/auth/kakao/callback';
  env.R2_PUBLIC_BASE_URL = 'https://images.whenwemeet.day';
  env.JWT_SECRET = 'x'.repeat(MIN_JWT_SECRET_LENGTH);
  return env;
}

describe('validateEnv', () => {
  it('운영이 아니면 비어 있어도 그대로 통과 (로컬은 카카오, R2 없이 기동)', () => {
    const env = { NODE_ENV: 'development' };
    expect(validateEnv(env)).toBe(env);
    expect(validateEnv({})).toEqual({});
  });

  it('운영 필수값이 모두 있으면 통과', () => {
    const env = productionEnv();
    expect(validateEnv(env)).toBe(env);
  });

  it('빠진 값은 이름만 모아 한 번에 알린다 (값은 싣지 않음)', () => {
    const env = productionEnv();
    delete env.JWT_SECRET;
    env.KAKAO_ADMIN_KEY = '   ';
    env.R2_BUCKET = '';
    expect(() => validateEnv(env)).toThrow(
      '없음: JWT_SECRET, KAKAO_ADMIN_KEY, R2_BUCKET',
    );
  });

  it('JWT_SECRET 이 짧으면 실패', () => {
    const env = { ...productionEnv(), JWT_SECRET: 'short-secret' };
    expect(() => validateEnv(env)).toThrow(
      `JWT_SECRET 은 ${MIN_JWT_SECRET_LENGTH}자 이상`,
    );
  });

  it('공개 URL 이 https 가 아니면 실패', () => {
    const env = {
      ...productionEnv(),
      WEB_ORIGIN: 'http://whenwemeet.day',
      R2_PUBLIC_BASE_URL: 'http://images.whenwemeet.day',
    };
    expect(() => validateEnv(env)).toThrow(
      'https:// 로 시작해야 함: WEB_ORIGIN, R2_PUBLIC_BASE_URL',
    );
  });

  it('애플 변수는 필수가 아니지만(D-55) APPLE_REDIRECT_URI 가 있으면 https 여야 한다', () => {
    expect(() => validateEnv(productionEnv())).not.toThrow();
    const env = {
      ...productionEnv(),
      APPLE_REDIRECT_URI: 'http://api.whenwemeet.day/v1/auth/apple/callback',
    };
    expect(() => validateEnv(env)).toThrow(
      'https:// 로 시작해야 함: APPLE_REDIRECT_URI',
    );
  });

  it('WEB_ORIGIN 끝의 / 는 리다이렉트 주소를 깨므로 실패', () => {
    const env = { ...productionEnv(), WEB_ORIGIN: 'https://whenwemeet.day/' };
    expect(() => validateEnv(env)).toThrow('WEB_ORIGIN 끝에 / 를 붙이지 않음');
  });

  it('오류 메시지에 비밀값이 섞이지 않는다', () => {
    const env = {
      ...productionEnv(),
      JWT_SECRET: 'leak-me',
      WEB_ORIGIN: 'http://x',
    };
    try {
      validateEnv(env);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('leak-me');
    }
  });
});
