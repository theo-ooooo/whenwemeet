import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssistantRequestDto } from './assistant-request.dto.js';

const check = async (body: unknown) => {
  const errors = await validate(plainToInstance(AssistantRequestDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...(error.children ?? []).flatMap((c) =>
      (c.children ?? []).flatMap((g) => Object.values(g.constraints ?? {})),
    ),
  ]);
};

describe('(#450) AssistantRequest 검사 (api.md 2.15)', () => {
  it('text: 앞뒤 공백 자르고 1~300자', async () => {
    expect(await check({ text: '  안녕  ' })).toEqual([]);
    expect(await check({ text: '   ' })).toContain('보낼 글을 적어 주세요');
    expect(await check({ text: '가'.repeat(301) })).toContain(
      '300자까지 보낼 수 있어요',
    );
    expect(await check({ text: 3 })).toContain('보낼 글을 적어 주세요');
    expect((await check({ text: 'a', groupId: 2 })).length).toBeGreaterThan(0);
  });

  it('history: 최대 10개, 턴 1~600자, role, 합계 4,000자', async () => {
    const turn = (text: string, role = 'user') => ({ role, text });
    expect(
      await check({
        text: 'a',
        history: [turn('b'), turn('[인사]', 'assistant')],
      }),
    ).toEqual([]);
    expect(
      (await check({ text: 'a', history: Array(11).fill(turn('b')) })).length,
    ).toBeGreaterThan(0);
    expect(
      await check({ text: 'a', history: [turn('b', 'system')] }),
    ).toContain('role 은 user 나 assistant 여야 해요');
    expect(await check({ text: 'a', history: [turn('')] })).toContain(
      '대화 한 턴은 1~600자여야 해요',
    );
    expect(
      await check({
        text: 'a',
        history: Array(7).fill(turn('가'.repeat(600))),
      }),
    ).toContain('대화 기록은 최근 10개, 합계 4,000자까지 보낼 수 있어요');
    expect(await check({ text: 'a', history: 'x' })).toContain(
      '대화 기록은 최근 10개, 합계 4,000자까지 보낼 수 있어요',
    );
  });
});
