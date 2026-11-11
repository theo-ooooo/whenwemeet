import { Module } from '@nestjs/common';
import { GroupActivitiesModule } from '../group-activities/group-activities.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { PushModule } from '../push/push.module.js';
import { ImportsController } from './imports.controller.js';
import { ImportsRepository } from './imports.repository.js';
import { ImportsService } from './imports.service.js';

/** (#279) ICS 파일 가져오기 */
@Module({
  imports: [GroupsModule, GroupActivitiesModule, PushModule],
  controllers: [ImportsController],
  providers: [ImportsService, ImportsRepository],
})
export class ImportsModule {}
