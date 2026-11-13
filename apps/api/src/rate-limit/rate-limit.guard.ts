import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { extractBearer, verifySessionSub } from '../auth/jwt-auth.guard.js';
import { RateLimitedException } from '../common/errors.js';
import { clientIpOf } from './client-ip.js';
import { RATE_LIMIT_KEY, SKIP_RATE_LIMIT_KEY, type RateLimitMeta } from './rate-limit.decorator.js';
import { DEFAULT_IP_RULE, DEFAULT_USER_RULE, RATE_LIMIT_POLICIES, type RateLimitRule } from './rate-limit.policies.js';
import { RateLimitStore, type RateLimitBucket } from './rate-limit.store.js';

/** 켜고 끄기와 시계. 운영은 항상 켜짐. e2e 헬퍼만 기존 테스트를 위해 끈다 (test/helpers.ts) */
@Injectable()
export class RateLimitSettings {
  enabled = true;
  now(): number {
    return Date.now();
  }
}

/** 요청자 식별값. user 는 서명을 확인한 JWT sub, 없으면 null. (#193) token 은 경로의 `:token` (없으면 null) */
export interface RateLimitSubject {
  ip: string;
  userId: number | null;
  token?: string | null;
}

/** (#193) 카운터 키에 넣는 경로 토큰 길이 상한. 긴 값으로 메모리를 늘리지 못하게 */
const MAX_TOKEN_KEY_LENGTH = 64;

/** 경로의 `:token` (문자열일 때만, 길면 자른다) */
export function pathTokenOf(request: Pick<Request, 'params'>): string | null {
  const token = (request.params as Record<string, unknown> | undefined)?.token;
  return typeof token === 'string' && token.length > 0 ? token.slice(0, MAX_TOKEN_KEY_LENGTH) : null;
}

/** 이 요청에 걸 버킷 목록. 기본 한도 하나 + 경로 한도(있으면). user 한도는 로그인 요청에만 */
export function bucketsFor(subject: RateLimitSubject, meta: RateLimitMeta | undefined): RateLimitBucket[] {
  const toBucket = (name: string, rule: RateLimitRule): RateLimitBucket | null => {
    if (rule.scope === 'user' && subject.userId === null) return null;
    if (rule.scope === 'token' && !subject.token) return null;
    const id = rule.scope === 'user' ? String(subject.userId) : rule.scope === 'token' ? subject.token : subject.ip;
    return { key: `${name}:${rule.scope}:${id}`, limit: rule.limit, windowSec: rule.windowSec };
  };
  const buckets = [toBucket('default', subject.userId === null ? DEFAULT_IP_RULE : DEFAULT_USER_RULE)];
  if (meta) buckets.push(...RATE_LIMIT_POLICIES[meta.policy].map((rule) => toBucket(meta.policy, rule)));
  return buckets.filter((b): b is RateLimitBucket => b !== null);
}

/**
 * (#186) 전역 요청 제한 가드 (api.md 1장 "요청 제한", D-143). JwtAuthGuard 보다 먼저 돈다(auth.module 의 등록 순서).
 * 그래서 토큰 없는 요청, 401 이 될 요청도 IP 기본 한도에 들어간다. 사용자 기준은 여기서 JWT 서명을 직접 확인한 sub
 * (서명이 틀린 토큰으로 남의 sub 를 대 그 사람 한도를 소진시키지 못하게). 넘으면 429 RATE_LIMITED
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly store: RateLimitStore,
    private readonly settings: RateLimitSettings,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.settings.enabled || context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, targets)) return true;
    const meta = this.reflector.getAllAndOverride<RateLimitMeta | undefined>(RATE_LIMIT_KEY, targets);

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearer(request.headers.authorization);
    const subject: RateLimitSubject = {
      ip: clientIpOf(request, this.config.get<string>('INTERNAL_API_KEY')),
      userId: token ? await verifySessionSub(this.jwt, token) : null,
      token: pathTokenOf(request),
    };

    const decision = this.store.consume(bucketsFor(subject, meta), this.settings.now());
    if (decision.allowed) return true;
    throw new RateLimitedException(decision.retryAfterSec, meta?.redirectToLogin ? this.loginUrl() : undefined);
  }

  private loginUrl(): string {
    return `${this.config.getOrThrow<string>('WEB_ORIGIN')}/login?error=RATE_LIMITED`;
  }
}
