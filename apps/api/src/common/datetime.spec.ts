import {
  EventInputDto,
  EventPatchDto,
  EventRangeQueryDto,
} from '../events/dto/event.dto.js';
import { FreeSlotsQueryDto } from '../free-slots/dto/free-slots-query.dto.js';
import { ApiException } from './errors.js';
import {
  createValidationPipe,
  ISO_DATETIME_WITH_OFFSET,
} from './validation.js';

/** 날짜시각 입력은 오프셋(Z 또는 ±HH:mm) 필수 (#61, 결정기록 D-40) */
describe('IsIsoDateTime', () => {
  const pipe = createValidationPipe();
  const fail = async (
    metatype: new () => object,
    value: object,
    type: 'body' | 'query' = 'body',
  ) =>
    (await pipe
      .transform(value, { type, metatype })
      .catch((e: unknown) => e)) as ApiException;

  it.each([
    '2026-11-22T10:00:00.000Z',
    '2026-11-22T10:00Z',
    '2026-11-22T10:00:00+09:00',
    '2026-11-22T01:00:00.123456-03:30',
  ])('%s 는 통과', (value) => {
    expect(ISO_DATETIME_WITH_OFFSET.test(value)).toBe(true);
  });

  it.each([
    '2026-11-22T10:00',
    '2026-11-22T10:00:00.000',
    '2026-11-22',
    '2026-11-22T10:00:00+0900',
    '2026-11-22 10:00Z',
  ])('%s 는 거부', (value) => {
    expect(ISO_DATETIME_WITH_OFFSET.test(value)).toBe(false);
  });

  it('오프셋 없는 일정 시각은 시간대 문구로 거부', async () => {
    const error = await fail(EventInputDto, {
      title: 't',
      startsAt: '2026-11-22T10:00',
      endsAt: '2026-11-22T11:00:00Z',
      allDay: false,
    });
    expect(error).toBeInstanceOf(ApiException);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual([
      {
        field: 'startsAt',
        message: 'startsAt 은 시간대(Z 또는 +09:00)가 붙은 날짜시각이어야 해요',
      },
    ]);
  });

  it('형식 자체가 틀리면 ISO 문구가 먼저', async () => {
    const error = await fail(EventPatchDto, { endsAt: 'abc' });
    expect(error.details).toEqual([
      { field: 'endsAt', message: 'endsAt 은 ISO 8601 날짜시각이어야 해요' },
    ]);
  });

  it('조회 쿼리 from/to 도 같은 규칙', async () => {
    const range = await fail(
      EventRangeQueryDto,
      { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00' },
      'query',
    );
    expect(range.details?.[0]).toEqual({
      field: 'to',
      message: 'to 는 시간대(Z 또는 +09:00)가 붙은 날짜시각이어야 해요',
    });
    const free = await fail(
      FreeSlotsQueryDto,
      { from: '2026-11-01T00:00', to: '2026-11-02T00:00:00Z' },
      'query',
    );
    expect(free.details?.[0]?.field).toBe('from');
  });

  it('오프셋이 있으면 +09:00 도 받는다', async () => {
    const dto = (await pipe.transform(
      {
        title: 't',
        startsAt: '2026-11-22T10:00:00+09:00',
        endsAt: '2026-11-22T11:00:00+09:00',
        allDay: false,
      },
      { type: 'body', metatype: EventInputDto },
    )) as EventInputDto;
    expect(dto.startsAt).toBe('2026-11-22T10:00:00+09:00');
  });
});
