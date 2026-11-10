import { Controller, Get, Logger } from '@nestjs/common';
import { Public } from '../auth/jwt-auth.guard.js';
import { ApiException } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * 인증 없는 상태 확인. 웹 점검 화면(#54)과 Railway healthcheck(#50) 가 쓴다.
 * DB 에 `SELECT 1` 을 보내 응답이 없으면 503 DB_UNAVAILABLE (배포 중 트래픽 전환을 막는다)
 */
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  async health(): Promise<{ ok: true }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      // 응답에는 숨기고 로그에만 원인을 남긴다 (#206 때 로그에 원인이 없어 추적이 늦었다)
      this.logger.warn(`DB 확인 실패: ${e instanceof Error ? e.message : String(e)}`);
      throw new ApiException('DB_UNAVAILABLE');
    }
    return { ok: true };
  }
}
