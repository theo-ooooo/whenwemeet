import { Injectable } from '@nestjs/common';
import type { AuthProviderClient, LinkedAccount } from './auth-provider.js';

/**
 * (#245) 이메일 링크/코드 로그인 제공자 (이메일-로그인.md 4-2). 로그인 자체는 `email-login` 모듈이 한다.
 * 외부 연결이 없어 탈퇴의 unlink 는 할 일이 없다. 발송 기록 삭제는 탈퇴 트랜잭션이 맡는다 (8-1)
 */
@Injectable()
export class EmailProvider implements AuthProviderClient {
  readonly provider = 'EMAIL' as const;

  async unlink(_account: LinkedAccount): Promise<void> {}
}
