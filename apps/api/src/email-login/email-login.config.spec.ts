import { fakeConfig } from '../testing/fake-config.js';
import { DEFAULT_EMAIL_FROM, DEFAULT_RESEND_API_URL, EmailLoginConfig, parseReview } from './email-login.config.js';

const BASE = { JWT_SECRET: 'unit-secret-0123456789abcdef0123456789', WEB_ORIGIN: 'http://localhost:3000/' };

describe('EmailLoginConfig (4-4)', () => {
  it('기본값: 꺼짐, Resend 주소와 보내는 주소 기본, WEB_ORIGIN 끝 / 제거', () => {
    const config = new EmailLoginConfig(fakeConfig(BASE));
    expect(config.enabled).toBe(false);
    expect(config.available).toBe(false);
    expect(config.resendApiUrl).toBe(DEFAULT_RESEND_API_URL);
    expect(config.from).toBe(DEFAULT_EMAIL_FROM);
    expect(config.webOrigin).toBe('http://localhost:3000');
    expect(config.internalApiKey).toBeNull();
    expect(config.resendApiKey).toBeNull();
    expect(config.review).toBeNull();
  });

  it('스위치 1 이면 개발은 키 없이도 켜진다. 운영은 내부 키와 Resend 키가 다 있어야 (D-119)', () => {
    expect(new EmailLoginConfig(fakeConfig({ ...BASE, EMAIL_LOGIN_ENABLED: '1' })).available).toBe(true);
    expect(new EmailLoginConfig(fakeConfig({ ...BASE, EMAIL_LOGIN_ENABLED: 'true' })).available).toBe(false);
    const prod = { ...BASE, NODE_ENV: 'production', EMAIL_LOGIN_ENABLED: '1' };
    expect(new EmailLoginConfig(fakeConfig(prod)).available).toBe(false);
    expect(new EmailLoginConfig(fakeConfig({ ...prod, INTERNAL_API_KEY: 'k' })).available).toBe(false);
    expect(new EmailLoginConfig(fakeConfig({ ...prod, RESEND_API_KEY: 're_x' })).available).toBe(false);
    expect(new EmailLoginConfig(fakeConfig({ ...prod, INTERNAL_API_KEY: 'k', RESEND_API_KEY: 're_x' })).available).toBe(true);
  });

  it('RESEND_API_URL, EMAIL_FROM 덮어쓰기', () => {
    const config = new EmailLoginConfig(fakeConfig({ ...BASE, RESEND_API_URL: 'http://127.0.0.1:9/', EMAIL_FROM: 'x <x@y.z>' }));
    expect(config.resendApiUrl).toBe('http://127.0.0.1:9');
    expect(config.from).toBe('x <x@y.z>');
  });

  it('심사 계정: 이메일은 정규화해 비교, 설정이 불완전하면 꺼짐 (D-118)', () => {
    const config = new EmailLoginConfig(fakeConfig({ ...BASE, EMAIL_LOGIN_ENABLED: '1', REVIEW_EMAIL: ' Review@WhenWeMeet.day ', REVIEW_CODE: '012345' }));
    expect(config.review).toEqual({ email: 'review@whenwemeet.day', code: '012345' });
    expect(config.isReviewEmail('review@whenwemeet.day')).toBe(true);
    expect(config.isReviewEmail('other@whenwemeet.day')).toBe(false);
    expect(new EmailLoginConfig(fakeConfig({ ...BASE, EMAIL_LOGIN_ENABLED: '1', REVIEW_EMAIL: 'r@x.io' })).isReviewEmail('r@x.io')).toBe(false);
  });

  it('parseReview: 둘 중 하나라도 비거나 코드가 6자리 숫자가 아니면 null', () => {
    expect(parseReview('r@x.io', '123456')).toEqual({ email: 'r@x.io', code: '123456' });
    expect(parseReview('', '123456')).toBeNull();
    expect(parseReview('r@x.io', '')).toBeNull();
    expect(parseReview('r@x.io', '12345')).toBeNull();
    expect(parseReview('r@x.io', '12345a')).toBeNull();
    expect(parseReview('not-email', '123456')).toBeNull();
    expect(parseReview(undefined, undefined)).toBeNull();
  });

  it('JWT_SECRET 이 없으면 기동 실패, 있으면 코드 키와 IP 키를 파생', () => {
    expect(() => new EmailLoginConfig(fakeConfig({ WEB_ORIGIN: 'x' }))).toThrow('JWT_SECRET');
    const config = new EmailLoginConfig(fakeConfig(BASE));
    expect(config.codeKey).toHaveLength(32);
    expect(config.codeKey.equals(config.ipKey)).toBe(false);
  });
});
