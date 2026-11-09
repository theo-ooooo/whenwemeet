import { vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';

/** 단위 테스트용 PrismaService 목. 쓰는 메서드만 vi.fn 으로 두고 $transaction 은 같은 목을 넘겨 콜백을 실행한다 */
export function createPrismaMock() {
  const delegate = () => ({
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  });
  const mock = {
    user: delegate(),
    group: delegate(),
    membership: delegate(),
    event: delegate(),
    anniversary: delegate(),
    eventLog: delegate(),
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation(async (fn: (tx: typeof mock) => Promise<unknown>) => fn(mock));
  return mock;
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;

export function asPrisma(mock: PrismaMock): PrismaService {
  return mock as unknown as PrismaService;
}

export const USER_ROW = { nickname: '앨리스', profileImageUrl: null };

export function membershipRow(overrides: Partial<{
  id: string;
  userId: string;
  groupId: string;
  color: string;
  displayName: string | null;
  lastSeenAt: Date;
  joinedAt: Date;
  user: { nickname: string; profileImageUrl: string | null };
}> = {}) {
  return {
    id: 'm1',
    userId: 'u1',
    groupId: 'g1',
    color: '#F26D6D',
    displayName: null,
    lastSeenAt: new Date('2026-11-01T00:00:00.000Z'),
    joinedAt: new Date('2026-11-01T00:00:00.000Z'),
    user: USER_ROW,
    ...overrides,
  };
}
