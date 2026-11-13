import { Module } from '@nestjs/common';
import { AuthLinkTicketsRepository } from './auth-link-tickets.repository.js';

/** (#198) 로그인 방법 연결 티켓 (D-257) */
@Module({
  providers: [AuthLinkTicketsRepository],
  exports: [AuthLinkTicketsRepository],
})
export class AuthLinkTicketsModule {}
