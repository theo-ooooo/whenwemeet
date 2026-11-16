import { clientSourceOf, logCreateSource } from './client-source.js';

describe('(#450) X-Client-Source', () => {
  it('허용 값만 받고 그 밖은 무시', () => {
    expect(clientSourceOf('assistant')).toBe('assistant');
    expect(clientSourceOf('assistant-poll')).toBe('assistant-poll');
    expect(clientSourceOf('assistant-edit')).toBe('assistant-edit');
    expect(clientSourceOf('assistant-edit-changed')).toBe('assistant-edit-changed');
    expect(clientSourceOf('Assistant')).toBeNull();
    expect(clientSourceOf(undefined)).toBeNull();
    expect(clientSourceOf(['assistant'])).toBeNull();
  });

  it('만든 결과를 그대로 돌려준다 (동작 변화 없음), 실패도 그대로 던진다', async () => {
    const created = { id: 7, title: 't' };
    await expect(logCreateSource('event_create', 'assistant', { userId: 1, groupId: 2 }, Promise.resolve(created))).resolves.toBe(created);
    await expect(logCreateSource('poll_create', 'x', { userId: 1, groupId: 2 }, Promise.resolve(created))).resolves.toBe(created);
    await expect(logCreateSource('poll_create', 'assistant-poll', { userId: 1, groupId: 2 }, Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
