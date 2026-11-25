import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { PushModule } from '../push/push.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminNoticesController, NoticesController } from './notices.controller.js';
import { NoticesRepository } from './notices.repository.js';
import { NoticesService } from './notices.service.js';

/** (#515) 공지사항 (D-285) */
@Module({
  imports: [UsersModule, AdminModule, PushModule],
  controllers: [NoticesController, AdminNoticesController],
  providers: [NoticesRepository, NoticesService],
  exports: [NoticesService],
})
export class NoticesModule {}
