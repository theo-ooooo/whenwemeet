import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { EmailLoginConfig } from './email-login.config.js';
import { EmailLoginController } from './email-login.controller.js';
import { EmailLoginGuard } from './email-login.guard.js';
import { EmailLoginChallengesRepository } from './email-login.repository.js';
import { EmailLoginService } from './email-login.service.js';
import { createMailClient, MAIL_CLIENT } from './mail-client.js';

/** (#245) 이메일 링크 + 6자리 코드 로그인 (이메일-로그인.md). 메일러는 MAIL_CLIENT 로 주입 (테스트는 가짜) */
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [EmailLoginController],
  providers: [
    EmailLoginConfig,
    EmailLoginGuard,
    EmailLoginChallengesRepository,
    EmailLoginService,
    { provide: MAIL_CLIENT, inject: [EmailLoginConfig], useFactory: (config: EmailLoginConfig) => createMailClient(config) },
  ],
  // (#198) 이메일 연결 코드 확인 (POST /me/auth-accounts)
  exports: [EmailLoginService],
})
export class EmailLoginModule {}
