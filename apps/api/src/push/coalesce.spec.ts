import { coalesce, coalesceKey } from './coalesce.js';

describe('coalesce (설계 5-4 표)', () => {
  const created = { changeAction: 'CREATED' as const, eventLogId: 1 };
  const updated = { changeAction: 'UPDATED' as const, eventLogId: 1 };

  it('대기 중인 묶음이 없으면 새 알림', () => {
    expect(coalesce(null, { id: 1, action: 'CREATED' }, false)).toEqual({ type: 'create' });
    expect(coalesce(null, { id: 1, action: 'DELETED' }, true)).toEqual({ type: 'create' });
  });

  it('CREATED + UPDATED → CREATED 유지, 보일 로그는 새 로그', () => {
    expect(coalesce(created, { id: 2, action: 'UPDATED' }, false)).toEqual({ type: 'update', changeAction: 'CREATED', eventLogId: 2 });
  });

  it('CREATED + DELETED, 원본 행이 지워짐 → 취소 (둘 다 안 보냄)', () => {
    expect(coalesce(created, { id: 2, action: 'DELETED' }, true)).toEqual({ type: 'cancel' });
  });

  it('CREATED + DELETED, 원본이 남음 ("이 일정만" 삭제 등) → 그대로', () => {
    expect(coalesce(created, { id: 2, action: 'DELETED' }, false)).toEqual({ type: 'keep' });
  });

  it('UPDATED + UPDATED → 새 로그', () => {
    expect(coalesce(updated, { id: 3, action: 'UPDATED' }, false)).toEqual({ type: 'update', changeAction: 'UPDATED', eventLogId: 3 });
  });

  it('UPDATED + DELETED → DELETED, 새 로그', () => {
    expect(coalesce(updated, { id: 3, action: 'DELETED' }, true)).toEqual({ type: 'update', changeAction: 'DELETED', eventLogId: 3 });
  });

  it('묶음 키는 사람과 일정 (다른 사람, 다른 일정은 따로)', () => {
    expect(coalesceKey(1, 100)).toBe('1:100');
    expect(coalesceKey(2, 100)).not.toBe(coalesceKey(1, 100));
    expect(coalesceKey(1, 101)).not.toBe(coalesceKey(1, 100));
  });
});
