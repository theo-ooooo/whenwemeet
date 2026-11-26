import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { AnniversariesRepository } from './anniversaries.repository.js';
import { AnniversariesService, assertAnniversaryDate, dateStringToDb, dbToDateString } from './anniversaries.service.js';
import { CreateAnniversaryDto, UpdateAnniversaryDto } from './dto/anniversary.dto.js';
import { ApiException } from '../common/errors.js';
import { createValidationPipe } from '../common/validation.js';

const config = { getOrThrow: () => 'http://web' } as never;
const ROW = {
  id: 200,
  groupId: 10,
  name: '기념일',
  date: new Date('2024-03-15T00:00:00.000Z'),
  kind: 'COUNT_UP' as const,
  calendar: 'SOLAR' as const,
  isLeapMonth: false,
  remindDayOf: true,
  remindDayBefore: false,
  remindWeekBefore: false,
  creatorId: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  creator: null,
};

const FOUND = { id: 200, date: ROW.date, calendar: 'SOLAR' as const, isLeapMonth: false };

describe('date 변환', () => {
  it('YYYY-MM-DD ↔ UTC 자정 Date', () => {
    expect(dateStringToDb('2024-03-15').toISOString()).toBe('2024-03-15T00:00:00.000Z');
    expect(dbToDateString(new Date('2024-03-15T00:00:00.000Z'))).toBe('2024-03-15');
  });
});

/** (#191) 새 소식 기록용 사람: 요청자 id + 팀 표시 이름 ?? 닉네임 스냅샷 */
const ACTOR = { id: 1, name: '앨리스' };

describe('AnniversariesService', () => {
  let anniversaries: RepositoryMock<AnniversariesRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: AnniversariesService;

  beforeEach(() => {
    anniversaries = mockRepository(AnniversariesRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new AnniversariesService(anniversaries as never, memberships);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
  });

  it('멤버가 아니면 FORBIDDEN', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.list(9, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create(9, 10, { name: 'x', date: '2024-01-01' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update(9, 10, 200, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.remove(9, 10, 200)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(anniversaries.listByGroup).not.toHaveBeenCalled();
    expect(anniversaries.findIdInGroup).not.toHaveBeenCalled();
  });

  it('list: 팀 기념일을 날짜 문자열로, 탈퇴자는 "탈퇴한 멤버"', async () => {
    anniversaries.listByGroup.mockResolvedValue([ROW]);
    const list = await service.list(1, 10);
    expect(anniversaries.listByGroup).toHaveBeenCalledWith(10);
    expect(list[0]).toMatchObject({ id: 200, date: '2024-03-15', kind: 'COUNT_UP', creator: { userId: null, displayName: '탈퇴한 멤버' } });
  });

  it('create: 문자열 날짜를 UTC 자정으로 저장, 종류를 안 보내면 COUNT_UP', async () => {
    anniversaries.createWithActivityTx.mockResolvedValue({ ...ROW, creatorId: 1, creator: { nickname: '앨리스', profileImageUrl: null } });
    const created = await service.create(1, 10, { name: '기념일', date: '2024-03-15' });
    expect(anniversaries.createWithActivityTx).toHaveBeenCalledWith({
      groupId: 10,
      name: '기념일',
      date: new Date('2024-03-15T00:00:00.000Z'),
      kind: 'COUNT_UP',
      calendar: 'SOLAR',
      isLeapMonth: false,
      remindDayOf: true,
      remindDayBefore: false,
      remindWeekBefore: false,
      creatorId: 1,
    }, ACTOR);
    expect(created.creator.displayName).toBe('앨리스');
    expect(created.kind).toBe('COUNT_UP');
    expect(created.reminders).toEqual(['DAY_OF']);
  });

  it('create / update: 알림 시점 배열을 칸 3개로, 응답은 당일, 하루 전, 일주일 전 순 (#269)', async () => {
    anniversaries.createWithActivityTx.mockResolvedValue({ ...ROW, remindDayOf: false, remindDayBefore: true, remindWeekBefore: true });
    const created = await service.create(1, 10, { name: '생일', date: '2000-05-05', reminders: ['WEEK_BEFORE', 'DAY_BEFORE'] });
    expect(anniversaries.createWithActivityTx).toHaveBeenCalledWith(expect.objectContaining({ remindDayOf: false, remindDayBefore: true, remindWeekBefore: true }), ACTOR);
    expect(created.reminders).toEqual(['DAY_BEFORE', 'WEEK_BEFORE']);

    anniversaries.findIdInGroup.mockResolvedValue(FOUND);
    anniversaries.updateWithActivityTx.mockResolvedValue({ ...ROW, remindDayOf: false });
    const none = await service.update(1, 10, 200, { reminders: [] });
    expect(anniversaries.updateWithActivityTx).toHaveBeenCalledWith(200, { remindDayOf: false, remindDayBefore: false, remindWeekBefore: false }, ACTOR);
    expect(none.reminders).toEqual([]);
  });

  it('create: 지정한 종류를 그대로 저장하고 응답에 싣는다', async () => {
    anniversaries.createWithActivityTx.mockResolvedValue({ ...ROW, kind: 'YEARLY' });
    const created = await service.create(1, 10, { name: '생일', date: '2000-05-05', kind: 'YEARLY' });
    expect(anniversaries.createWithActivityTx).toHaveBeenCalledWith(expect.objectContaining({ kind: 'YEARLY' }), ACTOR);
    expect(created.kind).toBe('YEARLY');
  });

  it('update: 종류만 바꾸면 kind 만 전달', async () => {
    anniversaries.findIdInGroup.mockResolvedValue(FOUND);
    anniversaries.updateWithActivityTx.mockResolvedValue({ ...ROW, kind: 'ONCE' });
    const updated = await service.update(1, 10, 200, { kind: 'ONCE' });
    expect(anniversaries.updateWithActivityTx).toHaveBeenCalledWith(200, { kind: 'ONCE' }, ACTOR);
    expect(updated).toMatchObject({ kind: 'ONCE', date: '2024-03-15' });
  });

  it('update / remove: 다른 팀 ID 는 NOT_FOUND, 부분 변경만 전달', async () => {
    anniversaries.findIdInGroup.mockResolvedValueOnce(null);
    await expect(service.update(1, 10, 999, { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(anniversaries.updateWithActivityTx).not.toHaveBeenCalled();

    anniversaries.findIdInGroup.mockResolvedValue(FOUND);
    anniversaries.updateWithActivityTx.mockResolvedValue({ ...ROW, date: new Date('2024-03-16T00:00:00.000Z') });
    const updated = await service.update(1, 10, 200, { date: '2024-03-16' });
    // (#562) 날짜를 바꾸면 달력 종류와 윤달도 합친 값으로 함께 저장한다
    expect(anniversaries.updateWithActivityTx).toHaveBeenCalledWith(200, { date: new Date('2024-03-16T00:00:00.000Z'), calendar: 'SOLAR', isLeapMonth: false }, ACTOR);
    expect(updated.date).toBe('2024-03-16');

    await service.update(1, 10, 200, { name: '새' });
    expect(anniversaries.updateWithActivityTx).toHaveBeenLastCalledWith(200, { name: '새' }, ACTOR);

    anniversaries.deleteWithActivityTx.mockResolvedValue(undefined);
    expect(await service.remove(1, 10, 200)).toEqual({ ok: true });
    expect(anniversaries.deleteWithActivityTx).toHaveBeenCalledWith(200, ACTOR);

    anniversaries.findIdInGroup.mockResolvedValueOnce(null);
    await expect(service.remove(1, 10, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(anniversaries.deleteWithActivityTx).toHaveBeenCalledTimes(1);
  });

  it('새 소식 기록 이름은 팀 표시 이름이 있으면 그것 (#191, D-152)', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow({ displayName: '앨리' }));
    anniversaries.findIdInGroup.mockResolvedValue(FOUND);
    anniversaries.deleteWithActivityTx.mockResolvedValue(undefined);
    await service.remove(1, 10, 200);
    expect(anniversaries.deleteWithActivityTx).toHaveBeenCalledWith(200, { id: 1, name: '앨리' });
  });
});

/** kind 는 전역 ValidationPipe 에서 셋 중 하나만 통과 (#106) */
describe('기념일 DTO kind 검증', () => {
  const pipe = createValidationPipe();
  const run = (metatype: new () => object, value: object) => pipe.transform(value, { type: 'body', metatype });

  it.each(['COUNT_UP', 'YEARLY', 'ONCE'])('%s 는 생성, 수정 모두 통과', async (kind) => {
    await expect(run(CreateAnniversaryDto, { name: 'x', date: '2024-01-01', kind })).resolves.toMatchObject({ kind });
    await expect(run(UpdateAnniversaryDto, { kind })).resolves.toMatchObject({ kind });
  });

  it('생략하면 kind 가 없다 (서비스가 COUNT_UP 으로 채움)', async () => {
    const dto = (await run(CreateAnniversaryDto, { name: 'x', date: '2024-01-01' })) as CreateAnniversaryDto;
    expect(dto.kind).toBeUndefined();
  });

  it.each([['소문자', 'yearly'], ['없는 값', 'WEEKLY'], ['숫자', 1], ['null', null]])('%s 는 VALIDATION_FAILED', async (_label, kind) => {
    for (const [metatype, value] of [
      [CreateAnniversaryDto, { name: 'x', date: '2024-01-01', kind }],
      [UpdateAnniversaryDto, { kind }],
    ] as const) {
      const error = await run(metatype, value).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiException);
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });
});

describe('(#562) 음력 기념일 검사 assertAnniversaryDate', () => {
  const fieldOf = (fn: () => void) => {
    try {
      fn();
      return null;
    } catch (error) {
      return (error as ApiException & { details: { field: string }[] }).details[0].field;
    }
  };

  it('음력은 그 해에 정말 있는 날짜, 윤달은 그 해에 그 윤달이 있을 때만', () => {
    expect(fieldOf(() => assertAnniversaryDate('2026-01-30', 'LUNAR', false))).toBeNull();
    expect(fieldOf(() => assertAnniversaryDate('2025-06-15', 'LUNAR', true))).toBeNull();
    expect(fieldOf(() => assertAnniversaryDate('2026-02-30', 'LUNAR', false))).toBe('date');
    expect(fieldOf(() => assertAnniversaryDate('2026-06-15', 'LUNAR', true))).toBe('isLeapMonth');
    expect(fieldOf(() => assertAnniversaryDate('2051-01-01', 'LUNAR', false))).toBe('date');
  });

  it('양력은 실제 날짜이고 윤달은 거부', () => {
    expect(fieldOf(() => assertAnniversaryDate('2026-02-28', 'SOLAR', false))).toBeNull();
    expect(fieldOf(() => assertAnniversaryDate('2026-02-30', 'SOLAR', false))).toBe('date');
    expect(fieldOf(() => assertAnniversaryDate('2026-02-28', 'SOLAR', true))).toBe('isLeapMonth');
  });
});

describe('(#562) 음력 기념일 서비스', () => {
  let anniversaries: RepositoryMock<AnniversariesRepository>;
  let service: AnniversariesService;

  beforeEach(() => {
    anniversaries = mockRepository(AnniversariesRepository);
    const membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new AnniversariesService(anniversaries as never, memberships);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
  });

  it('create: 음력 윤달을 저장하고 응답에 싣는다. 없는 윤달은 저장 전에 400', async () => {
    anniversaries.createWithActivityTx.mockResolvedValue({ ...ROW, date: new Date('2025-06-15T00:00:00.000Z'), calendar: 'LUNAR', isLeapMonth: true });
    const created = await service.create(1, 10, { name: '제사', date: '2025-06-15', kind: 'YEARLY', calendar: 'LUNAR', isLeapMonth: true });
    expect(anniversaries.createWithActivityTx).toHaveBeenCalledWith(expect.objectContaining({ calendar: 'LUNAR', isLeapMonth: true }), ACTOR);
    expect(created).toMatchObject({ date: '2025-06-15', calendar: 'LUNAR', isLeapMonth: true });
    await expect(service.create(1, 10, { name: '제사', date: '2026-06-15', calendar: 'LUNAR', isLeapMonth: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(anniversaries.createWithActivityTx).toHaveBeenCalledTimes(1);
  });

  it('update: 저장된 음력 날짜에 윤달만 켜도 합쳐서 검사, 양력으로 바꾸면 윤달은 끈다', async () => {
    anniversaries.findIdInGroup.mockResolvedValue({ id: 200, date: new Date('2025-06-15T00:00:00.000Z'), calendar: 'LUNAR', isLeapMonth: false });
    anniversaries.updateWithActivityTx.mockResolvedValue(ROW);
    await service.update(1, 10, 200, { isLeapMonth: true });
    expect(anniversaries.updateWithActivityTx).toHaveBeenLastCalledWith(200, { calendar: 'LUNAR', isLeapMonth: true }, ACTOR);

    anniversaries.findIdInGroup.mockResolvedValue({ id: 200, date: new Date('2025-06-15T00:00:00.000Z'), calendar: 'LUNAR', isLeapMonth: true });
    await service.update(1, 10, 200, { calendar: 'SOLAR' });
    expect(anniversaries.updateWithActivityTx).toHaveBeenLastCalledWith(200, { calendar: 'SOLAR', isLeapMonth: false }, ACTOR);

    // 저장된 날짜가 2026 음력이면 윤6월이 없다
    anniversaries.findIdInGroup.mockResolvedValue({ id: 200, date: new Date('2026-06-15T00:00:00.000Z'), calendar: 'LUNAR', isLeapMonth: false });
    await expect(service.update(1, 10, 200, { isLeapMonth: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'isLeapMonth' }] });
  });
});
