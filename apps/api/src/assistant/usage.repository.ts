import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * (#450) AI 비서 하루 사용 횟수 (설계 AI-비서.md 1-1, D-269). 사용자 + KST 날짜당 한 행.
 * 조건이 WHERE 에 있어 드라이버의 found rows 설정과 관계없이 영향 행 수로 통과를 판정한다. 넘친 요청은 세지 않는다
 */
@Injectable()
export class AssistantUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 한 번 센다. 통과하면 센 뒤의 횟수, 한도를 넘으면 null.
   * 1. count < limit 이면 +1 → 2. 행이 없으면 INSERT IGNORE (그날 첫 번째) → 3. 첫 요청 둘이 겹쳤으면 1을 한 번 더
   */
  async take(userId: number, day: string, limit: number): Promise<number | null> {
    const counted = await this.increment(userId, day, limit);
    if (counted !== null) return counted;
    const inserted = await this.prisma.$executeRaw`INSERT IGNORE INTO \`AssistantUsage\` (\`userId\`, \`day\`, \`count\`) VALUES (${userId}, ${day}, 1)`;
    if (inserted === 1) return 1;
    return this.increment(userId, day, limit);
  }

  /** 우리 쪽 실패(503, 504, 500)로 답을 못 준 요청을 되돌린다 */
  async refund(userId: number, day: string): Promise<void> {
    await this.prisma.$executeRaw`UPDATE \`AssistantUsage\` SET \`count\` = \`count\` - 1 WHERE \`userId\` = ${userId} AND \`day\` = ${day} AND \`count\` > 0`;
  }

  /** 그날 쓴 횟수. 행이 없으면 0 */
  async count(userId: number, day: string): Promise<number> {
    const row = await this.prisma.assistantUsage.findUnique({
      where: { userId_day: { userId, day: new Date(`${day}T00:00:00.000Z`) } },
      select: { count: true },
    });
    return row?.count ?? 0;
  }

  /**
   * count < limit 이면 +1 하고 센 뒤의 값, 아니면(행 없음 포함) null.
   * 센 뒤의 값은 같은 연결의 LAST_INSERT_ID(expr) 로 읽어 동시 요청에서도 내 요청이 몇 번째인지 정확하다 (배치 트랜잭션은 한 연결)
   */
  private async increment(userId: number, day: string, limit: number): Promise<number | null> {
    const [updated, rows] = await this.prisma.$transaction([
      this.prisma.$executeRaw`UPDATE \`AssistantUsage\` SET \`count\` = LAST_INSERT_ID(\`count\` + 1) WHERE \`userId\` = ${userId} AND \`day\` = ${day} AND \`count\` < ${limit}`,
      this.prisma.$queryRaw<{ n: bigint | number }[]>`SELECT LAST_INSERT_ID() AS n`,
    ]);
    return updated === 1 ? Number(rows[0].n) : null;
  }
}
