import {
  clientSourceOf,
  logChangeSource,
  logCreateSource,
} from './client-source.js';

describe('(#450) X-Client-Source', () => {
  it('허용 값만 받고 그 밖은 무시', () => {
    expect(clientSourceOf('assistant')).toBe('assistant');
    expect(clientSourceOf('assistant-poll')).toBe('assistant-poll');
    expect(clientSourceOf('assistant-edit')).toBe('assistant-edit');
    expect(clientSourceOf('assistant-edit-changed')).toBe(
      'assistant-edit-changed',
    );
    expect(clientSourceOf('Assistant')).toBeNull();
    expect(clientSourceOf(undefined)).toBeNull();
    expect(clientSourceOf(['assistant'])).toBeNull();
  });

  it('만든 결과를 그대로 돌려준다 (동작 변화 없음), 실패도 그대로 던진다', async () => {
    const created = { id: 7, title: 't' };
    await expect(
      logCreateSource(
        'event_create',
        'assistant',
        { userId: 1, groupId: 2 },
        Promise.resolve(created),
      ),
    ).resolves.toBe(created);
    await expect(
      logCreateSource(
        'poll_create',
        'x',
        { userId: 1, groupId: 2 },
        Promise.resolve(created),
      ),
    ).resolves.toBe(created);
    await expect(
      logCreateSource(
        'poll_create',
        'assistant-poll',
        { userId: 1, groupId: 2 },
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
  });

  it('(#511) 고치기, 지우기도 결과를 그대로 돌려주고 실패는 그대로 던진다', async () => {
    const removed = { ok: true, deletionId: 3 };
    await expect(
      logChangeSource(
        'event_delete',
        'assistant',
        { userId: 1, groupId: 2, id: 7 },
        Promise.resolve(removed),
      ),
    ).resolves.toBe(removed);
    await expect(
      logChangeSource(
        'event_update',
        undefined,
        { userId: 1, groupId: 2, id: 7 },
        Promise.resolve(removed),
      ),
    ).resolves.toBe(removed);
    await expect(
      logChangeSource(
        'event_update',
        'assistant',
        { userId: 1, groupId: 2, id: 7 },
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
  });
});
