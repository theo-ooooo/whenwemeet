import { Module } from '@nestjs/common';
import { EventResponsesDataModule } from '../event-responses/event-responses-data.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { PushModule } from '../push/push.module.js';
import { EventDeletionsController, EventLookupController, EventsController } from './events.controller.js';
import { EventSeriesService } from './event-series.service.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [GroupsModule, PushModule, EventResponsesDataModule],
  controllers: [EventsController, EventLookupController, EventDeletionsController],
  providers: [EventsService, EventSeriesService, EventsRepository],
  exports: [EventsRepository, EventsService],
})
export class EventsModule {}
