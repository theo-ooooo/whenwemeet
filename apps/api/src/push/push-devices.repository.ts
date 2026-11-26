import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Platform } from './push-copy.js';
import type { PreferenceKind } from '../notification-preferences/notification-preferences.js';
import { NotificationPreferencesRepository } from '../notification-preferences/notification-preferences.repository.js';

/** 사용자당 기기 상한 (D-83) */
export const MAX_DEVICES_PER_USER = 10;

/** 내 정보 > 알림 (설계 7-1) */
export interface NotificationSettings {
  reminder: boolean;
  change: boolean;
  anniversary: boolean;
  join: boolean;
  /** (#277) 주간 요약. 기본 켬 */
  weekly: boolean;
  /** (#277) 다 같이 비는 시간 (조용한 팀 깨우기). 기본 끔 (D-204) */
  weeklyNudge: boolean;
  /** (#189) 약속 투표. 기본 켬 */
  poll: boolean;
  /** (#528) 공지. 기본 켬 (D-287) */
  notice: boolean;
}

export interface DeviceInput {
  token: string;
  platform: Platform;
  appVersion: string;
}

/** (#369) 설정 API 키 ↔ 알림 종류 (NotificationPreference.kind, D-249) */
const SETTING_KIND: Record<keyof NotificationSettings, PreferenceKind> = {
  reminder: 'REMINDER',
  change: 'CHANGE',
  anniversary: 'ANNIVERSARY',
  join: 'JOIN',
  weekly: 'WEEKLY',
  weeklyNudge: 'WEEKLY_NUDGE',
  poll: 'POLL',
  notice: 'NOTICE',
};

/** 종류별 값 → 설정 API 모양. (#528) 관리자 사용자 상세도 같은 모양을 쓴다 */
export function toNotificationSettings(
  values: Record<PreferenceKind, boolean>,
): NotificationSettings {
  return Object.fromEntries(
    Object.entries(SETTING_KIND).map(([key, kind]) => [key, values[kind]]),
  ) as unknown as NotificationSettings;
}

/** 푸시 기기와 알림 설정 저장소 (#188, #485) */
@Injectable()
export class PushDevicesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesRepository,
  ) {}

  // ---------- 기기 (설계 2-3, 7-1) ----------

  /** token 으로 upsert (다른 사용자 행이면 나로 옮긴다). 내 기기가 상한을 넘으면 lastSeenAt 가 오래된 것부터 지운다 */
  async registerDevice(
    userId: number,
    input: DeviceInput,
    now: Date,
    maxDevices = MAX_DEVICES_PER_USER,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const data = {
        userId,
        platform: input.platform,
        appVersion: input.appVersion,
        lastSeenAt: now,
      };
      await tx.pushDevice.upsert({
        where: { token: input.token },
        create: { token: input.token, ...data },
        update: data,
      });
      const overflow = await tx.pushDevice.findMany({
        where: { userId },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        skip: maxDevices,
        select: { id: true },
      });
      if (overflow.length > 0)
        await tx.pushDevice.deleteMany({
          where: { id: { in: overflow.map((row) => row.id) } },
        });
    });
  }

  /** 내 기기 행만 지운다. 없어도 그대로 (멱등) */
  async removeDevice(userId: number, token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { userId, token } });
  }

  /** 발송, 영수증의 DeviceNotRegistered */
  async deleteDevicesByTokens(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0;
    const { count } = await this.prisma.pushDevice.deleteMany({
      where: { token: { in: tokens } },
    });
    return count;
  }

  // ---------- 설정 (설계 7-1) ----------

  async getSettings(userId: number): Promise<NotificationSettings | null> {
    const values = await this.preferences.find(userId);
    return values && toNotificationSettings(values);
  }

  async updateSettings(
    userId: number,
    patch: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> {
    const values: Partial<Record<PreferenceKind, boolean>> = {};
    for (const [key, kind] of Object.entries(SETTING_KIND) as [
      keyof NotificationSettings,
      PreferenceKind,
    ][]) {
      if (patch[key] !== undefined) values[kind] = patch[key];
    }
    return toNotificationSettings(await this.preferences.set(userId, values));
  }
}
