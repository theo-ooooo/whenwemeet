import { Module } from '@nestjs/common';
import { GroupActivitiesModule } from '../group-activities/group-activities.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { AnniversariesController } from './anniversaries.controller.js';
import { AnniversariesRepository } from './anniversaries.repository.js';
import { AnniversariesService } from './anniversaries.service.js';
import { BirthdaysController } from './birthdays.controller.js';
import { BirthdaysRepository } from './birthdays.repository.js';
import { BirthdaysService } from './birthdays.service.js';

@Module({
  imports: [GroupsModule, GroupActivitiesModule],
  controllers: [AnniversariesController, BirthdaysController],
  providers: [AnniversariesService, AnniversariesRepository, BirthdaysService, BirthdaysRepository],
  /** (#193) 구독 피드가 기념일과 (#305) 멤버 생일을 읽는다. (#450) AI 비서가 기념일, 생일 목록을 읽는다 */
  exports: [AnniversariesRepository, BirthdaysRepository, AnniversariesService, BirthdaysService],
})
export class AnniversariesModule {}
