import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { PushModule } from '../push/push.module.js';
import { EventLookupController, EventsController } from './events.controller.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [GroupsModule, PushModule],
  controllers: [EventsController, EventLookupController],
  providers: [EventsService, EventsRepository],
  exports: [EventsRepository],
})
export class EventsModule {}
