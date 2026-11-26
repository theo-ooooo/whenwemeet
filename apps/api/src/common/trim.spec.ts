import {
  CreateAnniversaryDto,
  UpdateAnniversaryDto,
} from '../anniversaries/dto/anniversary.dto.js';
import { EventInputDto, EventPatchDto } from '../events/dto/event.dto.js';
import {
  CreateGroupDto,
  UpdateGroupDto,
  UpdateMeDto,
} from '../groups/dto/group.dto.js';
import { UpdateProfileDto } from '../me/dto/update-profile.dto.js';
import { ApiException } from './errors.js';
import { createValidationPipe } from './validation.js';

/** 이름/제목 문자열은 앞뒤 공백을 자른 뒤 검증하고 잘린 값을 넘긴다 (#59) */
describe('Trim (전역 ValidationPipe 경유)', () => {
  const pipe = createValidationPipe();
  const run = (metatype: new () => object, value: object) =>
    pipe.transform(value, { type: 'body', metatype });

  const event = {
    startsAt: '2026-12-01T10:00:00.000Z',
    endsAt: '2026-12-01T11:00:00.000Z',
    allDay: false,
  };

  it.each([
    [
      '팀 이름 생성',
      CreateGroupDto,
      { name: '  우리 팀  ' },
      'name',
      '우리 팀',
    ],
    [
      '팀 이름 수정',
      UpdateGroupDto,
      { name: '\t우리 팀\n' },
      'name',
      '우리 팀',
    ],
    [
      '표시 이름',
      UpdateMeDto,
      { displayName: ' 짝꿍 ' },
      'displayName',
      '짝꿍',
    ],
    [
      '일정 제목 생성',
      EventInputDto,
      { ...event, title: ' 저녁 ' },
      'title',
      '저녁',
    ],
    ['일정 제목 수정', EventPatchDto, { title: ' 저녁 ' }, 'title', '저녁'],
    [
      '기념일 이름 생성',
      CreateAnniversaryDto,
      { name: ' 처음 만난 날 ', date: '2024-03-16' },
      'name',
      '처음 만난 날',
    ],
    [
      '기념일 이름 수정',
      UpdateAnniversaryDto,
      { name: ' 처음 만난 날 ' },
      'name',
      '처음 만난 날',
    ],
    [
      '닉네임',
      UpdateProfileDto,
      { nickname: ' 앨리스 ' },
      'nickname',
      '앨리스',
    ],
  ])(
    '%s: 앞뒤 공백을 잘라 넘긴다',
    async (_label, metatype, value, field, expected) => {
      const result = (await run(metatype, value)) as Record<string, unknown>;
      expect(result[field]).toBe(expected);
    },
  );

  it.each([
    ['팀 이름 생성', CreateGroupDto, { name: '   ' }, 'name'],
    ['팀 이름 수정', UpdateGroupDto, { name: ' \t ' }, 'name'],
    ['표시 이름', UpdateMeDto, { displayName: '  ' }, 'displayName'],
    ['일정 제목 생성', EventInputDto, { ...event, title: '   ' }, 'title'],
    ['일정 제목 수정', EventPatchDto, { title: '   ' }, 'title'],
    [
      '기념일 이름 생성',
      CreateAnniversaryDto,
      { name: '   ', date: '2024-03-16' },
      'name',
    ],
    ['기념일 이름 수정', UpdateAnniversaryDto, { name: '   ' }, 'name'],
    ['닉네임', UpdateProfileDto, { nickname: '   ' }, 'nickname'],
  ])(
    '%s: 공백만이면 VALIDATION_FAILED',
    async (_label, metatype, value, field) => {
      const error = (await run(metatype, value).catch(
        (e: unknown) => e,
      )) as ApiException;
      expect(error).toBeInstanceOf(ApiException);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details?.[0]?.field).toBe(field);
    },
  );

  it('문자열이 아니면 자르지 않고 형식 오류로 거부', async () => {
    const error = (await run(CreateGroupDto, { name: 123 }).catch(
      (e: unknown) => e,
    )) as ApiException;
    expect(error.message).toBe('팀 이름은 문자열이어야 해요');
  });

  it('표시 이름 null 은 그대로 (닉네임으로 되돌리기)', async () => {
    const result = (await run(UpdateMeDto, {
      displayName: null,
    })) as UpdateMeDto;
    expect(result.displayName).toBeNull();
  });
});
