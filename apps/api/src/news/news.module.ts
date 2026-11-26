import { Module } from '@nestjs/common';
import { EventLogsModule } from '../event-logs/event-logs.module.js';
import { GroupActivitiesModule } from '../group-activities/group-activities.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { NewsController } from './news.controller.js';
import { NewsService } from './news.service.js';

@Module({
  imports: [
    GroupsModule,
    MembershipsModule,
    EventLogsModule,
    GroupActivitiesModule,
  ],
  controllers: [NewsController],
  providers: [NewsService],
})
export class NewsModule {}
