import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AvatarsModule } from '../avatars/avatars.module.js';
import { EmailLoginModule } from '../email-login/email-login.module.js';
import { AuthAccountsController } from './auth-accounts.controller.js';
import { AuthAccountsRepository } from './auth-accounts.repository.js';
import { AuthAccountsService } from './auth-accounts.service.js';

/** (#198) 로그인 방법 연결, 해제 (D-257) */
@Module({
  imports: [AuthModule, AvatarsModule, EmailLoginModule],
  controllers: [AuthAccountsController],
  providers: [AuthAccountsRepository, AuthAccountsService],
})
export class AuthAccountsModule {}
