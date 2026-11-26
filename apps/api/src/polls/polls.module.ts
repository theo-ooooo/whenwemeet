import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { FreeSlotsModule } from '../free-slots/free-slots.module.js';
import { GroupActivitiesModule } from '../group-activities/group-activities.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { PushModule } from '../push/push.module.js';
import { PollLookupController, PollsController } from './polls.controller.js';
import { PollsRepository } from './polls.repository.js';
import { PollsService } from './polls.service.js';

/** (#189) 약속 투표. 마감 알림은 PushModule 의 틱이 맡는다 (PollPlanner) */
@Module({
  imports: [
    GroupsModule,
    EventsModule,
    FreeSlotsModule,
    GroupActivitiesModule,
    PushModule,
  ],
  controllers: [PollsController, PollLookupController],
  providers: [PollsService, PollsRepository],
})
export class PollsModule {}
