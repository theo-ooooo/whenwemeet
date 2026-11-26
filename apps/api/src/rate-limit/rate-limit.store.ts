import { Injectable } from '@nestjs/common';

/** 카운터 하나에 대한 요청. key 는 `<한도 이름>:<scope>:<값>` */
export interface RateLimitBucket {
  key: string;
  limit: number;
  windowSec: number;
}

export type RateLimitDecision =
  { allowed: true } | { allowed: false; retryAfterSec: number };

interface Counter {
  count: number;
  resetAt: number;
}

/** 만료된 카운터를 지우는 간격. 요청이 올 때 함께 지운다 (타이머를 두지 않는다) */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * (#186) 메모리 고정 창 카운터 (D-143). API 는 한 인스턴스라 공유 저장소 없이 프로세스 안에서 센다.
 * 재시작하면 0 부터 다시 센다 (승인된 설계)
 */
@Injectable()
export class RateLimitStore {
  private readonly counters = new Map<string, Counter>();
  private lastSweepAt = 0;

  /**
   * 버킷을 모두 확인하고, 하나라도 한도에 닿았으면 아무것도 세지 않고 거절한다.
   * 모두 여유가 있으면 전부 1씩 센다. retryAfterSec 은 막힌 버킷 중 가장 늦게 풀리는 것 기준
   */
  consume(buckets: readonly RateLimitBucket[], now: number): RateLimitDecision {
    this.sweep(now);
    let retryAfterMs = 0;
    for (const bucket of buckets) {
      const counter = this.live(bucket.key, now);
      if (counter && counter.count >= bucket.limit)
        retryAfterMs = Math.max(retryAfterMs, counter.resetAt - now);
    }
    if (retryAfterMs > 0)
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };

    for (const bucket of buckets) {
      const counter = this.live(bucket.key, now);
      if (counter) counter.count += 1;
      else
        this.counters.set(bucket.key, {
          count: 1,
          resetAt: now + bucket.windowSec * 1000,
        });
    }
    return { allowed: true };
  }

  /** 테스트와 운영 확인용: 지금 들고 있는 카운터 수 */
  get size(): number {
    return this.counters.size;
  }

  private live(key: string, now: number): Counter | undefined {
    const counter = this.counters.get(key);
    if (counter && counter.resetAt <= now) {
      this.counters.delete(key);
      return undefined;
    }
    return counter;
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;
    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now) this.counters.delete(key);
    }
  }
}
