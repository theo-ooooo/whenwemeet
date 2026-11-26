import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import {
  EventShareLinksController,
  EventSharesController,
} from './event-shares.controller.js';
import { EventSharesDataModule } from './event-shares-data.module.js';
import { EventSharesService } from './event-shares.service.js';

/** (#274) 일정 카드 공유 (D-181 ~ D-185) */
@Module({
  imports: [GroupsModule, EventsModule, EventSharesDataModule],
  controllers: [EventShareLinksController, EventSharesController],
  providers: [EventSharesService],
})
export class EventSharesModule {}
