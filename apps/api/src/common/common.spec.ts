import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
  ValidationError,
} from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ApiException, DEFAULT_MESSAGE } from './errors.js';
import { HttpExceptionFilter, MALFORMED_REQUEST_MESSAGE } from './http-exception.filter.js';
import { parseIdParam } from './id-param.js';
import { DELETED_MEMBER, MEMBER_COLORS, MemberResolver, pickLeastUsedColor, toMember } from './member.js';
import { ResponseInterceptor } from './response.interceptor.js';
import { collectViolations, createValidationPipe, firstValidationMessage, isCalendarDate, parseIsoDate } from './validation.js';

describe('ApiException', () => {
  it('코드별 HTTP 상태와 기본 문구로 실패 봉투를 만든다', () => {
    const e = new ApiException('INVITE_NOT_FOUND');
    expect(e.getStatus()).toBe(404);
    expect(e.toBody()).toEqual({ status: 404, data: null, message: DEFAULT_MESSAGE.INVITE_NOT_FOUND, error: { code: 'INVITE_NOT_FOUND' } });
    expect(new ApiException('FORBIDDEN', '직접 문구').toBody()).toEqual({ status: 403, data: null, message: '직접 문구', error: { code: 'FORBIDDEN' } });
  });

  it('details 가 있으면 error.details 로, 없으면 키를 넣지 않는다', () => {
    const details = [{ field: 'name', message: '이름' }];
    expect(new ApiException('VALIDATION_FAILED', '이름', details).toBody()).toEqual({
      status: 400,
      data: null,
      message: '이름',
      error: { code: 'VALIDATION_FAILED', details },
    });
    expect(new ApiException('VALIDATION_FAILED').toBody().error).not.toHaveProperty('details');
  });
});

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it.each([
    [new ApiException('KAKAO_ERROR'), 502, 'KAKAO_ERROR'],
    [new NotFoundException('Cannot GET /x'), 404, 'NOT_FOUND'],
    [new UnauthorizedException(), 401, 'UNAUTHORIZED'],
    [new BadRequestException(['첫 번째', '두 번째']), 400, 'VALIDATION_FAILED'],
    [new PayloadTooLargeException(), 413, 'PAYLOAD_TOO_LARGE'],
    [new InternalServerErrorException(), 500, 'INTERNAL'],
    [new Error('boom'), 500, 'INTERNAL'],
    ['문자열', 500, 'INTERNAL'],
  ])('%s → %i %s', (exception, status, code) => {
    const result = filter.translate(exception);
    expect(result.status).toBe(status);
    expect(result.body.status).toBe(status);
    expect(result.body.data).toBeNull();
    expect(result.body.error.code).toBe(code);
  });

  it('프레임워크가 던진 400 은 영어 원문 대신 고정 한국어 문구, 500 은 고정 문구 (#60)', () => {
    // body-parser 의 잘못된 JSON 은 Nest 가 BadRequestException(SyntaxError.message) 로 바꿔 넘긴다
    expect(filter.translate(new BadRequestException('Unexpected token \'g\', "garbage" is not valid JSON')).body).toEqual({
      status: 400,
      data: null,
      message: MALFORMED_REQUEST_MESSAGE,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(filter.translate(new BadRequestException(['첫 번째', '두 번째'])).body.message).toBe(MALFORMED_REQUEST_MESSAGE);
    expect(filter.translate(new Error('x')).body.message).toBe('잠시 후 다시 시도해 주세요');
  });

  it('본문 크기 초과(413) 는 PAYLOAD_TOO_LARGE 와 한국어 문구 (#60)', () => {
    // body-parser 의 PayloadTooLargeError 는 Nest 가 HttpException(message, 413) 으로 바꿔 넘긴다
    expect(filter.translate(new HttpException('request entity too large', 413)).body).toEqual({
      status: 413,
      data: null,
      message: DEFAULT_MESSAGE.PAYLOAD_TOO_LARGE,
      error: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('5xx HttpException 은 내부 문구를 숨기고, 표에 없는 4xx 는 400 VALIDATION_FAILED', () => {
    expect(filter.translate(new InternalServerErrorException('DB 비밀번호 틀림')).body).toEqual({
      status: 500,
      data: null,
      message: DEFAULT_MESSAGE.INTERNAL,
      error: { code: 'INTERNAL' },
    });
    const conflict = filter.translate(new ConflictException('충돌'));
    expect(conflict.status).toBe(400);
    expect(conflict.body).toMatchObject({ status: 400, message: MALFORMED_REQUEST_MESSAGE, error: { code: 'VALIDATION_FAILED' } });
  });

  it('catch 는 상태와 본문을 응답에 쓴다', () => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    filter.catch(new ApiException('FORBIDDEN'), host as never);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ status: 403, data: null, message: DEFAULT_MESSAGE.FORBIDDEN, error: { code: 'FORBIDDEN' } });

    const errorSpy = vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    filter.catch(new Error('boom'), host as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('ResponseInterceptor', () => {
  const contextWith = (statusCode: number) => ({ switchToHttp: () => ({ getResponse: () => ({ statusCode }) }) }) as never;

  it('{ status: 응답 코드, data, message: "OK" } 로 감싼다', async () => {
    const interceptor = new ResponseInterceptor();
    const out = await firstValueFrom(interceptor.intercept(contextWith(200), { handle: () => of({ ok: true }) }));
    expect(out).toEqual({ status: 200, data: { ok: true }, message: 'OK' });
    const created = await firstValueFrom(interceptor.intercept(contextWith(201), { handle: () => of([1]) }));
    expect(created).toEqual({ status: 201, data: [1], message: 'OK' });
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

  it('collectViolations 는 필드마다 한 줄, 중첩은 parent.child 경로', () => {
    expect(
      collectViolations([
        { property: 'title', constraints: { maxLength: '50자 이하', isString: '문자열' } },
        { property: 'extra', constraints: { whitelistValidation: 'x' } },
        { property: 'nested', children: [{ property: 'inner', constraints: { isString: '안쪽' } }] },
        { property: 'empty' },
      ]),
    ).toEqual([
      { field: 'title', message: '문자열' },
      { field: 'extra', message: 'extra 은(는) 허용되지 않는 항목이에요' },
      { field: 'nested.inner', message: '안쪽' },
    ]);
  });

  it('createValidationPipe 의 exceptionFactory 는 details 를 단 ApiException', () => {
    const pipe = createValidationPipe();
    const factory = (pipe as unknown as { exceptionFactory: (e: ValidationError[]) => unknown }).exceptionFactory;
    const error = factory([
      { property: 'name', constraints: { isString: '이름' } },
      { property: 'color', constraints: { matches: '색' } },
    ]) as ApiException;
    expect(error).toBeInstanceOf(ApiException);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('이름');
    expect(error.details).toEqual([
      { field: 'name', message: '이름' },
      { field: 'color', message: '색' },
    ]);
    expect((factory([]) as ApiException).message).toBe(DEFAULT_MESSAGE.VALIDATION_FAILED);
  });

  it('isCalendarDate / parseIsoDate', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-2-3')).toBe(false);
    expect(parseIsoDate('2026-11-09T05:00:00.000Z', 'from').toISOString()).toBe('2026-11-09T05:00:00.000Z');
    expect(() => parseIsoDate('nope', 'from')).toThrow(ApiException);
    try {
      parseIsoDate('nope', 'from');
    } catch (error) {
      expect((error as ApiException).details).toEqual([{ field: 'from', message: 'from 은(는) ISO 8601 날짜시각이어야 해요' }]);
    }
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

  it('pickLeastUsedColor 는 앞 7개만 배정하고 8번째 키(#F279B5)는 주지 않는다 (D-57)', () => {
    const firstSeven = MEMBER_COLORS.slice(0, 7);
    // 앞 7개가 한 번씩 쓰였으면 8번째가 아니라 첫 색으로 돌아간다
    expect(pickLeastUsedColor([...firstSeven])).toBe(MEMBER_COLORS[0]);
    // 8번째 키를 가진 기존 멤버가 있어도 후보에서 빠진다
    expect(pickLeastUsedColor([...firstSeven, MEMBER_COLORS[7]])).toBe(MEMBER_COLORS[0]);
    // 7명이 지나도록 배정해도 8번째 키는 한 번도 나오지 않는다
    const used: string[] = [];
    for (let i = 0; i < 20; i++) used.push(pickLeastUsedColor(used));
    expect(used).not.toContain(MEMBER_COLORS[7]);
    expect(new Set(used.slice(0, 7))).toEqual(new Set(firstSeven));
  });

  it('toMember 는 displayName ?? nickname', () => {
    const base = { userId: 1, color: '#000000', joinedAt: new Date(0), user: { nickname: '닉', profileImageUrl: 'p' } };
    expect(toMember({ ...base, displayName: null }).displayName).toBe('닉');
    expect(toMember({ ...base, displayName: '별명' }).displayName).toBe('별명');
  });

  it('MemberResolver: 멤버 / 나간 사용자 / 탈퇴자', () => {
    const resolver = new MemberResolver([
      { userId: 1, color: '#111111', displayName: '별명', joinedAt: new Date(0), user: { nickname: '닉', profileImageUrl: null } },
    ]);
    expect(resolver.resolve(1, { nickname: '닉', profileImageUrl: null })).toEqual({ userId: 1, displayName: '별명', color: '#111111', profileImageUrl: null });
    expect(resolver.resolve(2, { nickname: '나감', profileImageUrl: 'img' })).toEqual({ userId: 2, displayName: '나감', color: '#9CA3AF', profileImageUrl: 'img' });
    expect(resolver.resolve(null, null)).toBe(DELETED_MEMBER);
    expect(resolver.resolve(3, null)).toBe(DELETED_MEMBER);
  });
});

describe('parseIdParam (경로 파라미터 ID)', () => {
  it.each([['1', 1], ['42', 42], ['2147483647', 2147483647]])('%s → %d', (raw, id) => {
    expect(parseIdParam('groupId', raw)).toBe(id);
  });

  it.each(['0', '-1', '01', '1.5', '1e3', 'abc', 'ckabc123', '', ' 1', '2147483648', '99999999999', undefined, 7])('%j → 400 VALIDATION_FAILED + details', (raw) => {
    try {
      parseIdParam('groupId', raw);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).toBody()).toEqual({
        status: 400,
        data: null,
        message: 'groupId 은(는) 양의 정수여야 해요',
        error: { code: 'VALIDATION_FAILED', details: [{ field: 'groupId', message: 'groupId 은(는) 양의 정수여야 해요' }] },
      });
    }
  });
});
