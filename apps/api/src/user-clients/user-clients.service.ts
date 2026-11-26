import { Injectable, Logger } from '@nestjs/common';
import type { ClientInfo } from './client-platform.js';
import { UserClientsRepository } from './user-clients.repository.js';

/** 같은 사용자, 기종을 다시 쓰기까지의 간격 (D-288) */
export const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
/** 메모리 캐시 크기. 넘으면 가장 오래 쓴 것부터 버린다 (버려진 사람은 다음 요청에 한 번 더 쓸 뿐) */
export const TOUCH_CACHE_MAX = 10_000;

/** 시계. 테스트가 바꾼다 */
@Injectable()
export class UserClientsClock {
  now(): number {
    return Date.now();
  }
}

/**
 * (#532) 접속 기종 기록 (D-288). 같은 (userId, platform) 은 1시간에 한 번만 DB 에 쓴다(인스턴스 메모리 캐시).
 * 실패해도 요청은 그대로 (로그만). 앱 버전이 바뀌면 간격 안이라도 바로 쓴다
 */
@Injectable()
export class UserClientsService {
  private readonly logger = new Logger('UserClients');
  /** 키 `userId:platform` → { 마지막으로 쓴 시각, 그때 버전 }. Map 의 넣은 순서를 LRU 로 쓴다 */
  private readonly written = new Map<
    string,
    { at: number; appVersion: string | null }
  >();

  constructor(
    private readonly repo: UserClientsRepository,
    private readonly clock: UserClientsClock,
  ) {}

  /** 기록이 필요하면 쓰고 true, 간격 안이라 건너뛰면 false. 예외를 던지지 않는다 */
  async record(userId: number, client: ClientInfo): Promise<boolean> {
    const key = `${userId}:${client.platform}`;
    const now = this.clock.now();
    const prev = this.written.get(key);
    if (
      prev &&
      now - prev.at < TOUCH_INTERVAL_MS &&
      prev.appVersion === client.appVersion
    )
      return false;
    this.remember(key, { at: now, appVersion: client.appVersion });
    try {
      await this.repo.touch(userId, client, new Date(now));
      return true;
    } catch (e) {
      // 다음 요청에서 다시 시도하도록 캐시를 지운다 (탈퇴 직후의 FK 오류 등)
      this.written.delete(key);
      this.logger.warn(
        `기종 기록 실패 userId=${userId} platform=${client.platform}: ${(e as Error).message}`,
      );
      return false;
    }
  }

  private remember(
    key: string,
    value: { at: number; appVersion: string | null },
  ): void {
    this.written.delete(key);
    this.written.set(key, value);
    if (this.written.size > TOUCH_CACHE_MAX) {
      const oldest = this.written.keys().next().value;
      if (oldest !== undefined) this.written.delete(oldest);
    }
  }

  /** 테스트용: 캐시 크기 */
  get cacheSize(): number {
    return this.written.size;
  }
}
