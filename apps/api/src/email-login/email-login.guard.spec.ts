import type { ExecutionContext } from '@nestjs/common';
import { fakeConfig } from '../testing/fake-config.js';
import { EmailLoginConfig } from './email-login.config.js';
import { EmailLoginGuard, UNKNOWN_IP } from './email-login.guard.js';

const SECRET = 'unit-secret-0123456789abcdef0123456789';

function context(headers: Record<string, string | string[]>) {
  const request: {
    headers: Record<string, string | string[]>;
    emailClientIp?: string;
  } = { headers };
  const response = { setHeader: vi.fn() };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { ctx, request, response };
}

function guard(env: Record<string, string>): EmailLoginGuard {
  return new EmailLoginGuard(
    new EmailLoginConfig(fakeConfig({ JWT_SECRET: SECRET, ...env })),
  );
}

describe('EmailLoginGuard (4-1, D-115, D-119)', () => {
  it('스위치가 꺼져 있으면 503 EMAIL_NOT_CONFIGURED, 오류 응답도 no-store', () => {
    const { ctx, response } = context({});
    expect(() => guard({}).canActivate(ctx)).toThrow(
      expect.objectContaining({ code: 'EMAIL_NOT_CONFIGURED' }),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
  });

  it('운영에서 내부 키나 Resend 키가 없으면 503', () => {
    const { ctx } = context({ 'x-internal-key': 'k' });
    expect(() =>
      guard({
        EMAIL_LOGIN_ENABLED: '1',
        NODE_ENV: 'production',
        RESEND_API_KEY: 're',
      }).canActivate(ctx),
    ).toThrow(expect.objectContaining({ code: 'EMAIL_NOT_CONFIGURED' }));
    expect(() =>
      guard({
        EMAIL_LOGIN_ENABLED: '1',
        NODE_ENV: 'production',
        INTERNAL_API_KEY: 'k',
      }).canActivate(ctx),
    ).toThrow(expect.objectContaining({ code: 'EMAIL_NOT_CONFIGURED' }));
  });

  it('키가 없거나 다르면 403, 맞으면 X-Client-IP 를 믿는다', () => {
    const g = guard({
      EMAIL_LOGIN_ENABLED: '1',
      INTERNAL_API_KEY: 'internal-key',
    });
    expect(() => g.canActivate(context({}).ctx)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() =>
      g.canActivate(context({ 'x-internal-key': 'wrong' }).ctx),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() =>
      g.canActivate(context({ 'x-internal-key': ['internal-key'] }).ctx),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));

    const ok = context({
      'x-internal-key': 'internal-key',
      'x-client-ip': ' 203.0.113.7 ',
    });
    expect(g.canActivate(ok.ctx)).toBe(true);
    expect(ok.request.emailClientIp).toBe('203.0.113.7');

    const noIp = context({ 'x-internal-key': 'internal-key' });
    g.canActivate(noIp.ctx);
    expect(noIp.request.emailClientIp).toBe(UNKNOWN_IP);
    const longIp = context({
      'x-internal-key': 'internal-key',
      'x-client-ip': 'x'.repeat(101),
    });
    g.canActivate(longIp.ctx);
    expect(longIp.request.emailClientIp).toBe(UNKNOWN_IP);
    const listIp = context({
      'x-internal-key': 'internal-key',
      'x-client-ip': ['198.51.100.1', '198.51.100.2'],
    });
    g.canActivate(listIp.ctx);
    expect(listIp.request.emailClientIp).toBe('198.51.100.1');
  });

  it('개발에서 내부 키가 비어 있으면 통과하되 X-Client-IP 는 믿지 않는다', () => {
    const { ctx, request } = context({ 'x-client-ip': '203.0.113.7' });
    expect(guard({ EMAIL_LOGIN_ENABLED: '1' }).canActivate(ctx)).toBe(true);
    expect(request.emailClientIp).toBe(UNKNOWN_IP);
  });
});
