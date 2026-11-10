import { ApiException } from '../common/errors.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const prisma = { $queryRaw: vi.fn() };
  const controller = new HealthController(prisma as never);

  beforeEach(() => {
    prisma.$queryRaw.mockReset();
  });

  it('DB 가 응답하면 { ok: true }', async () => {
    prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    await expect(controller.health()).resolves.toEqual({ ok: true });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('DB 오류면 503 DB_UNAVAILABLE (원인 문구는 숨긴다)', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.1:3306'),
    );
    const error = await controller.health().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    const api = error as ApiException;
    expect(api.code).toBe('DB_UNAVAILABLE');
    expect(api.getStatus()).toBe(503);
    expect(api.message).not.toContain('ECONNREFUSED');
  });
});
