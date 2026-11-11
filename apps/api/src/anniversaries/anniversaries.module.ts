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
})
export class AnniversariesModule {}
