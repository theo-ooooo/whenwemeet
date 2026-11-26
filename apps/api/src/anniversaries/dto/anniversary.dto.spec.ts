import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAnniversaryDto, UpdateAnniversaryDto } from './anniversary.dto.js';
import { fromReminderFlags, toReminderFlags } from '../anniversary-reminders.js';

/** 전역 ValidationPipe 와 같은 옵션 */
const fields = async (cls: typeof CreateAnniversaryDto | typeof UpdateAnniversaryDto, body: object) =>
  (await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe('기념일 알림 시점 DTO (#269, D-144)', () => {
  const base = { name: '생일', date: '2000-05-05' };

  it.each([
    ['생략', {}],
    ['빈 배열 = 알림 없음', { reminders: [] }],
    ['하나', { reminders: ['DAY_BEFORE'] }],
    ['셋, 순서 무관', { reminders: ['WEEK_BEFORE', 'DAY_OF', 'DAY_BEFORE'] }],
  ])('통과: %s', async (_, extra) => {
    expect(await fields(CreateAnniversaryDto, { ...base, ...extra })).toEqual([]);
    expect(await fields(UpdateAnniversaryDto, extra)).toEqual([]);
  });

  it.each([
    ['null', { reminders: null }],
    ['배열 아님', { reminders: 'DAY_OF' }],
    ['모르는 값', { reminders: ['MONTH_BEFORE'] }],
    ['소문자', { reminders: ['day_of'] }],
    ['중복', { reminders: ['DAY_OF', 'DAY_OF'] }],
    ['4개', { reminders: ['DAY_OF', 'DAY_BEFORE', 'WEEK_BEFORE', 'DAY_OF'] }],
  ])('거부: %s → reminders', async (_, extra) => {
    expect(await fields(CreateAnniversaryDto, { ...base, ...extra })).toEqual(['reminders']);
    expect(await fields(UpdateAnniversaryDto, extra)).toEqual(['reminders']);
  });

  it('배열 ↔ 칸 3개 (응답 순서 고정)', () => {
    expect(toReminderFlags(['WEEK_BEFORE'])).toEqual({ remindDayOf: false, remindDayBefore: false, remindWeekBefore: true });
    expect(fromReminderFlags(toReminderFlags(['WEEK_BEFORE', 'DAY_OF']))).toEqual(['DAY_OF', 'WEEK_BEFORE']);
    expect(fromReminderFlags(toReminderFlags([]))).toEqual([]);
  });
});

describe('(#562) 음력 기념일 DTO', () => {
  it('음력은 2월 30일 모양도 받는다 (그 해에 있는지는 서비스가 본다), 양력은 실제 날짜만', async () => {
    expect(await fields(CreateAnniversaryDto, { name: '제사', date: '2026-02-30', calendar: 'LUNAR' })).toEqual([]);
    expect(await fields(CreateAnniversaryDto, { name: '제사', date: '2026-02-30' })).toEqual(['date']);
    expect(await fields(CreateAnniversaryDto, { name: '제사', date: '2026-02-31', calendar: 'LUNAR' })).toEqual(['date']);
    // 수정에서 달력 종류를 생략하면 모양만 본다
    expect(await fields(UpdateAnniversaryDto, { date: '2026-02-30' })).toEqual([]);
    expect(await fields(UpdateAnniversaryDto, { date: '2026-02-32' })).toEqual(['date']);
  });

  it('달력 종류와 윤달 값 검사 (null, 모르는 값 거부)', async () => {
    expect(await fields(CreateAnniversaryDto, { name: '제사', date: '2025-06-15', calendar: 'LUNAR', isLeapMonth: true })).toEqual([]);
    expect(await fields(CreateAnniversaryDto, { name: '제사', date: '2025-06-15', calendar: 'lunar' })).toEqual(['calendar']);
    expect(await fields(UpdateAnniversaryDto, { calendar: null })).toEqual(['calendar']);
    expect(await fields(UpdateAnniversaryDto, { isLeapMonth: 'yes' })).toEqual(['isLeapMonth']);
  });
});
