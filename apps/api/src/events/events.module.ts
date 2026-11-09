import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [GroupsModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
