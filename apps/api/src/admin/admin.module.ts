import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AdminAccess, AdminGuard } from './admin-access.js';
import { AdminActionsRepository } from './admin-actions.repository.js';
import { AdminLogsController } from './admin-logs.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';

/** (#515) 관리자 판정(AdminAccess, AdminGuard)과 사용자 관리. 공지 작성은 NoticesModule 이 이 가드를 쓴다 */
@Module({
  imports: [UsersModule],
  controllers: [AdminUsersController, AdminLogsController],
  providers: [AdminAccess, AdminGuard, AdminActionsRepository, AdminUsersService],
  exports: [AdminAccess, AdminGuard, AdminActionsRepository],
})
export class AdminModule {}
