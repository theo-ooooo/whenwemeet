import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import {
  type DeviceInput,
  type NotificationSettings,
  PushDevicesRepository,
} from './push-devices.repository.js';

/** 기기 등록과 알림 설정 (설계 2-3, 7-1, D-80, D-83) */
@Injectable()
export class PushDevicesService {
  constructor(private readonly push: PushDevicesRepository) {}

  /** token 으로 upsert. 다른 사용자 행이면 나로 옮기고(한 기기는 한 사용자), 10대를 넘으면 오래된 기기를 지운다 */
  async register(
    userId: number,
    input: DeviceInput,
    now: Date = new Date(),
  ): Promise<{ ok: true }> {
    await this.push.registerDevice(userId, input, now);
    return { ok: true };
  }

  /** 로그아웃, OS 에서 알림을 끈 기기. 내 행만 지우고 없어도 200 (멱등) */
  async remove(userId: number, token: string): Promise<{ ok: true }> {
    await this.push.removeDevice(userId, token);
    return { ok: true };
  }

  async settings(userId: number): Promise<NotificationSettings> {
    const settings = await this.push.getSettings(userId);
    if (!settings) throw new ApiException('UNAUTHORIZED');
    return settings;
  }

  /** 빈 본문은 그대로 돌려준다 */
  async updateSettings(
    userId: number,
    patch: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> {
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<NotificationSettings>;
    if (Object.keys(defined).length === 0) return this.settings(userId);
    return this.push.updateSettings(userId, defined);
  }
}
