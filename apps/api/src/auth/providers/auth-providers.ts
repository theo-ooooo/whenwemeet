import { Injectable } from '@nestjs/common';
import type { AuthProvider, AuthProviderClient } from './auth-provider.js';
import { AppleProvider } from './apple.provider.js';
import { DevProvider } from './dev.provider.js';
import { EmailProvider } from './email.provider.js';
import { KakaoProvider } from './kakao.provider.js';

/** 제공자 이름 → 구현. 아직 붙이지 않은 제공자(GOOGLE, NAVER) 를 찾으면 500 (코드 버그) */
@Injectable()
export class AuthProviders {
  private readonly byName: ReadonlyMap<AuthProvider, AuthProviderClient>;

  constructor(
    kakao: KakaoProvider,
    dev: DevProvider,
    apple: AppleProvider,
    email: EmailProvider,
  ) {
    this.byName = new Map<AuthProvider, AuthProviderClient>(
      [kakao, dev, apple, email].map((client) => [client.provider, client]),
    );
  }

  get(provider: AuthProvider): AuthProviderClient {
    const client = this.byName.get(provider);
    if (!client) throw new Error(`지원하지 않는 로그인 제공자: ${provider}`);
    return client;
  }
}
