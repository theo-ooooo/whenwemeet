import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../prisma/prisma.service.js';
import {
  type PreferenceKind,
  resolvePreferences,
} from './notification-preferences.js';

const PREFERENCES_SELECT = {
  notificationPreferences: { select: { kind: true, enabled: true } },
} as const;

/**
 * (#369) 알림 종류 설정 (D-249). 쓰기는 준 종류만 upsert 하고 기본값과 같아도 행을 남긴다(사용자가 고른 값)
 */
@Injectable()
export class NotificationPreferencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 종류마다 지금 값 (행 + 기본값). 사용자가 없으면 null */
  async find(
    userId: number,
    db: Db = this.prisma,
  ): Promise<Record<PreferenceKind, boolean> | null> {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: PREFERENCES_SELECT,
    });
    return row && resolvePreferences(row.notificationPreferences);
  }

  /** 준 종류만 저장하고 저장 뒤 값을 돌려준다 */
  async set(
    userId: number,
    values: Partial<Record<PreferenceKind, boolean>>,
  ): Promise<Record<PreferenceKind, boolean>> {
    return this.prisma.$transaction(async (tx) => {
      for (const [kind, enabled] of Object.entries(values) as [
        PreferenceKind,
        boolean | undefined,
      ][]) {
        if (enabled === undefined) continue;
        await tx.notificationPreference.upsert({
          where: { userId_kind: { userId, kind } },
          create: { userId, kind, enabled },
          update: { enabled },
        });
      }
      return (await this.find(userId, tx))!;
    });
  }
}
