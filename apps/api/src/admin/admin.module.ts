import { Module } from '@nestjs/common';
import { NotificationPreferencesModule } from '../notification-preferences/notification-preferences.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminAccess, AdminGuard } from './admin-access.js';
import { AdminActionsRepository } from './admin-actions.repository.js';
import { AdminLogsController } from './admin-logs.controller.js';
import { AdminEventsController, AdminGroupsController } from './admin-moderation.controller.js';
import { AdminModerationRepository } from './admin-moderation.repository.js';
import { AdminModerationService } from './admin-moderation.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';

/** (#515) 관리자 판정(AdminAccess, AdminGuard), 사용자 관리, 팀과 일정 숨김, 삭제(D-286), 조치 기록. 공지 작성은 NoticesModule 이 이 가드를 쓴다 */
@Module({
  imports: [UsersModule, NotificationPreferencesModule],
  controllers: [AdminUsersController, AdminLogsController, AdminGroupsController, AdminEventsController],
  providers: [AdminAccess, AdminGuard, AdminActionsRepository, AdminUsersService, AdminModerationRepository, AdminModerationService],
  exports: [AdminAccess, AdminGuard, AdminActionsRepository],
})
export class AdminModule {}
