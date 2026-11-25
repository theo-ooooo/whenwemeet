import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { PushModule } from '../push/push.module.js';
import { UsersModule } from '../users/users.module.js';
import { NoticeReadsRepository } from './notice-reads.repository.js';
import { NoticeReadsService } from './notice-reads.service.js';
import { AdminNoticesController, NoticesController } from './notices.controller.js';
import { NoticesRepository } from './notices.repository.js';
import { NoticesService } from './notices.service.js';

/** (#515) 공지사항 (D-285). (#544) 읽음 기록과 관리자 결과 (D-293) */
@Module({
  imports: [UsersModule, AdminModule, PushModule],
  controllers: [NoticesController, AdminNoticesController],
  providers: [NoticesRepository, NoticesService, NoticeReadsRepository, NoticeReadsService],
  exports: [NoticesService],
})
export class NoticesModule {}
