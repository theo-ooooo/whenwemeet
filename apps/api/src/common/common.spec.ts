import { BadRequestException, InternalServerErrorException, NotFoundException, UnauthorizedException, ValidationError } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ApiException, DEFAULT_MESSAGE } from './errors.js';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { DELETED_MEMBER, MEMBER_COLORS, MemberResolver, pickLeastUsedColor, toMember } from './member.js';
import { ResponseInterceptor } from './response.interceptor.js';
import { createValidationPipe, firstValidationMessage, isCalendarDate, parseIsoDate } from './validation.js';

describe('ApiException', () => {
  it('코드별 HTTP 상태와 기본 문구를 가진다', () => {
    const e = new ApiException('INVITE_NOT_FOUND');
    expect(e.getStatus()).toBe(404);
    expect(e.getResponse()).toEqual({ error: { code: 'INVITE_NOT_FOUND', message: DEFAULT_MESSAGE.INVITE_NOT_FOUND } });
    expect(new ApiException('FORBIDDEN', '직접 문구').getResponse()).toEqual({ error: { code: 'FORBIDDEN', message: '직접 문구' } });
  });
});

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it.each([
    [new ApiException('KAKAO_ERROR'), 502, 'KAKAO_ERROR'],
    [new NotFoundException('Cannot GET /x'), 404, 'NOT_FOUND'],
    [new UnauthorizedException(), 401, 'UNAUTHORIZED'],
    [new BadRequestException(['첫 번째', '두 번째']), 400, 'VALIDATION_FAILED'],
    [new InternalServerErrorException(), 500, 'INTERNAL'],
    [new Error('boom'), 500, 'INTERNAL'],
    ['문자열', 500, 'INTERNAL'],
  ])('%s → %i %s', (exception, status, code) => {
    const result = filter.translate(exception);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
  });

  it('400 은 Nest 응답의 첫 메시지를 쓰고, 500 은 고정 문구', () => {
    expect(filter.translate(new BadRequestException(['첫 번째', '두 번째'])).body.error.message).toBe('첫 번째');
    expect(filter.translate(new BadRequestException('하나')).body.error.message).toBe('하나');
    expect(filter.translate(new BadRequestException({ message: '' })).body.error.message).toBe(DEFAULT_MESSAGE.VALIDATION_FAILED);
    expect(filter.translate(new Error('x')).body.error.message).toBe('잠시 후 다시 시도해 주세요');
  });

  it('catch 는 상태와 본문을 응답에 쓴다', () => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    filter.catch(new ApiException('FORBIDDEN'), host as never);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: { code: 'FORBIDDEN', message: DEFAULT_MESSAGE.FORBIDDEN } });

    const errorSpy = vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    filter.catch(new Error('boom'), host as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('ResponseInterceptor', () => {
  it('{ data } 로 감싼다', async () => {
    const interceptor = new ResponseInterceptor();
    const out = await firstValueFrom(interceptor.intercept({} as never, { handle: () => of({ ok: true }) }));
    expect(out).toEqual({ data: { ok: true } });
  });
});

describe('validation', () => {
  it('firstValidationMessage 는 형식 오류를 먼저, whitelist 위반은 한국어로', () => {
    const errors: ValidationError[] = [
      { property: 'minMinutes', constraints: { max: '720 이하', min: '30 이상', isInt: '정수' } },
    ];
    expect(firstValidationMessage(errors)).toBe('정수');
    expect(firstValidationMessage([{ property: 'extra', constraints: { whitelistValidation: 'x' } }])).toBe('extra 은(는) 허용되지 않는 항목이에요');
    expect(firstValidationMessage([{ property: 'nested', children: [{ property: 'inner', constraints: { isString: '안쪽' } }] }])).toBe('안쪽');
    expect(firstValidationMessage([{ property: 'empty' }])).toBe('입력값을 확인해 주세요');
  });

  it('createValidationPipe 의 exceptionFactory 는 ApiException', () => {
    const pipe = createValidationPipe();
    const factory = (pipe as unknown as { exceptionFactory: (e: ValidationError[]) => unknown }).exceptionFactory;
    const error = factory([{ property: 'name', constraints: { isString: '이름' } }]) as ApiException;
    expect(error).toBeInstanceOf(ApiException);
    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('isCalendarDate / parseIsoDate', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-2-3')).toBe(false);
    expect(parseIsoDate('2026-11-09T05:00:00.000Z', 'from').toISOString()).toBe('2026-11-09T05:00:00.000Z');
    expect(() => parseIsoDate('nope', 'from')).toThrow(ApiException);
  });
});

describe('member', () => {
  it('pickLeastUsedColor 는 가장 적게 쓰인 색, 동률이면 팔레트 순서', () => {
    expect(pickLeastUsedColor([])).toBe(MEMBER_COLORS[0]);
    expect(pickLeastUsedColor([MEMBER_COLORS[0]])).toBe(MEMBER_COLORS[1]);
    expect(pickLeastUsedColor([...MEMBER_COLORS])).toBe(MEMBER_COLORS[0]);
    expect(pickLeastUsedColor([...MEMBER_COLORS, MEMBER_COLORS[0].toLowerCase()])).toBe(MEMBER_COLORS[1]);
    expect(pickLeastUsedColor(['#123456'])).toBe(MEMBER_COLORS[0]);
  });

  it('toMember 는 displayName ?? nickname', () => {
    const base = { userId: 'u1', color: '#000000', joinedAt: new Date(0), user: { nickname: '닉', profileImageUrl: 'p' } };
    expect(toMember({ ...base, displayName: null }).displayName).toBe('닉');
    expect(toMember({ ...base, displayName: '별명' }).displayName).toBe('별명');
  });

  it('MemberResolver: 멤버 / 나간 사용자 / 탈퇴자', () => {
    const resolver = new MemberResolver([
      { userId: 'u1', color: '#111111', displayName: '별명', joinedAt: new Date(0), user: { nickname: '닉', profileImageUrl: null } },
    ]);
    expect(resolver.resolve('u1', { nickname: '닉', profileImageUrl: null })).toEqual({ userId: 'u1', displayName: '별명', color: '#111111', profileImageUrl: null });
    expect(resolver.resolve('u2', { nickname: '나감', profileImageUrl: 'img' })).toEqual({ userId: 'u2', displayName: '나감', color: '#9CA3AF', profileImageUrl: 'img' });
    expect(resolver.resolve(null, null)).toBe(DELETED_MEMBER);
    expect(resolver.resolve('u3', null)).toBe(DELETED_MEMBER);
  });
});
