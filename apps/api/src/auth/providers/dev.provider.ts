import { Injectable } from '@nestjs/common';
import type { AuthProviderClient, LinkedAccount, ProviderProfile } from './auth-provider.js';

/**
 * 개발 전용 제공자 (결정기록 D-29). "코드" 가 곧 닉네임이고, providerUserId 도 닉네임이라
 * 같은 닉네임으로 다시 들어오면 같은 사용자가 된다. 외부 연결이 없으므로 unlink 는 할 일이 없다
 */
@Injectable()
export class DevProvider implements AuthProviderClient {
  readonly provider = 'DEV' as const;

  async exchangeCode(nickname: string): Promise<ProviderProfile> {
    return { providerUserId: nickname, nickname, profileImageUrl: null, raw: { nickname } };
  }

  async unlink(_account: LinkedAccount): Promise<void> {}
}
