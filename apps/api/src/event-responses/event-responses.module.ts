import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { EventResponsesDataModule } from './event-responses-data.module.js';
import { EventResponsesController } from './event-responses.controller.js';
import { EventResponsesService } from './event-responses.service.js';

/** (#190) 일정 참석 여부와 짧은 반응 */
@Module({
  imports: [EventsModule, EventResponsesDataModule],
  controllers: [EventResponsesController],
  providers: [EventResponsesService],
})
export class EventResponsesModule {}
