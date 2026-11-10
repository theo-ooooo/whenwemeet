import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/jwt-auth.guard.js';
import { ApiException } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * 인증 없는 상태 확인. 웹 점검 화면(#54)과 Railway healthcheck(#50) 가 쓴다.
 * DB 에 `SELECT 1` 을 보내 응답이 없으면 503 DB_UNAVAILABLE (배포 중 트래픽 전환을 막는다)
 */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  async health(): Promise<{ ok: true }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ApiException('DB_UNAVAILABLE');
    }
    return { ok: true };
  }
}
