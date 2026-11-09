import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { FreeSlotsController } from './free-slots.controller.js';
import { FreeSlotsService } from './free-slots.service.js';

@Module({
  imports: [GroupsModule, MembershipsModule, EventsModule],
  controllers: [FreeSlotsController],
  providers: [FreeSlotsService],
})
export class FreeSlotsModule {}
