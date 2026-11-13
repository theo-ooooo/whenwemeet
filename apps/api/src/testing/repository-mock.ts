import { Mock, vi } from 'vitest';

/** 메서드마다 vi.fn 으로 바뀐 Repository 타입 */
export type RepositoryMock<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K];
};

/** 단위 테스트용 Repository 목. 프로토타입의 메서드를 전부 vi.fn 으로 두고 PrismaService 없이 만든다 */
export function mockRepository<T extends object>(ctor: abstract new (...args: never[]) => T): RepositoryMock<T> {
  const mock: Record<string, unknown> = {};
  for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
    if (name !== 'constructor') mock[name] = vi.fn();
  }
  return mock as RepositoryMock<T>;
}

export const USER_ROW = { nickname: '앨리스', profileImageUrl: null };

export function membershipRow(overrides: Partial<{
  id: number;
  userId: number;
  groupId: number;
  color: string;
  displayName: string | null;
  lastSeenAt: Date;
  joinedAt: Date;
  notify: boolean;
  showBirthday: boolean;
  user: { nickname: string; profileImageUrl: string | null };
}> = {}) {
  return {
    id: 1001,
    userId: 1,
    groupId: 10,
    color: '#F26D6D',
    displayName: null,
    lastSeenAt: new Date('2026-11-01T00:00:00.000Z'),
    joinedAt: new Date('2026-11-01T00:00:00.000Z'),
    notify: true,
    showBirthday: true,
    user: USER_ROW,
    ...overrides,
  };
}
