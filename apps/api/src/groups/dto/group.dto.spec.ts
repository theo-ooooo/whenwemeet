import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateGroupDto } from './group.dto.js';

/** 전역 ValidationPipe 와 같은 옵션 */
const fields = async (body: object) =>
  (
    await validate(plainToInstance(CreateGroupDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  ).map((e) => e.property);

describe('팀 만들기 DTO preset (#278, D-250)', () => {
  it.each([
    ['생략', {}],
    ['아는 값', { preset: 'family' }],
    ['모르는 값도 400 아님', { preset: 'couple' }],
    ['문자열이 아니어도 400 아님', { preset: 3 }],
    ['null', { preset: null }],
  ])('통과: %s', async (_, extra) => {
    expect(await fields({ name: '우리 가족', ...extra })).toEqual([]);
  });

  it('다른 낯선 항목은 여전히 거른다, 이름 규칙 그대로', async () => {
    expect(await fields({ name: '팀', purpose: 'two' })).toEqual(['purpose']);
    expect(await fields({ name: '', preset: 'two' })).toEqual(['name']);
  });
});
