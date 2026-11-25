import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ClientInfo } from './client-platform.js';

/** (#532) 접속 기종 기록 (D-288) */
@Injectable()
export class UserClientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** (userId, platform) 한 줄을 넣거나 lastSeenAt, appVersion 만 고친다. 쿼리 한 번 */
  async touch(userId: number, client: ClientInfo, at: Date): Promise<void> {
    await this.prisma.userClient.upsert({
      where: { userId_platform: { userId, platform: client.platform } },
      create: { userId, platform: client.platform, appVersion: client.appVersion, firstSeenAt: at, lastSeenAt: at },
      update: { appVersion: client.appVersion, lastSeenAt: at },
      select: { id: true },
    });
  }
}
