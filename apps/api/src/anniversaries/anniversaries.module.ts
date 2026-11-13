import { Module } from '@nestjs/common';
import { GroupActivitiesModule } from '../group-activities/group-activities.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { AnniversariesController } from './anniversaries.controller.js';
import { AnniversariesRepository } from './anniversaries.repository.js';
import { AnniversariesService } from './anniversaries.service.js';

@Module({
  imports: [GroupsModule, GroupActivitiesModule],
  controllers: [AnniversariesController],
  providers: [AnniversariesService, AnniversariesRepository],
  /** (#193) 구독 피드가 기념일을 읽는다 */
  exports: [AnniversariesRepository],
})
export class AnniversariesModule {}
