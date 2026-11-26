import { Module } from '@nestjs/common';
import { EventResponsesDataModule } from '../event-responses/event-responses-data.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { PushModule } from '../push/push.module.js';
import { EventBusyRepository } from './event-busy.repository.js';
import { EventReadsRepository } from './event-reads.repository.js';
import { EventRemovalsRepository } from './event-removals.repository.js';
import { EventSearchRepository } from './event-search.repository.js';
import { EventSeriesRepository } from './event-series.repository.js';
import { EventWritesRepository } from './event-writes.repository.js';
import {
  EventDeletionsController,
  EventLookupController,
  EventsController,
} from './events.controller.js';
import { EventSeriesService } from './event-series.service.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [GroupsModule, PushModule, EventResponsesDataModule],
  controllers: [
    EventsController,
    EventLookupController,
    EventDeletionsController,
  ],
  providers: [
    EventsService,
    EventSeriesService,
    EventReadsRepository,
    EventSearchRepository,
    EventBusyRepository,
    EventWritesRepository,
    EventSeriesRepository,
    EventRemovalsRepository,
  ],
  exports: [
    EventReadsRepository,
    EventBusyRepository,
    EventWritesRepository,
    EventsService,
  ],
})
export class EventsModule {}
