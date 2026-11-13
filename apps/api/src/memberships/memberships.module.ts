import { Module } from '@nestjs/common';
import { CalendarFeedsDataModule } from '../calendar-feed/calendar-feeds-data.module.js';
import { EventSharesDataModule } from '../event-shares/event-shares-data.module.js';
import { GroupActivitiesModule } from '../group-activities/group-activities.module.js';
import { PushModule } from '../push/push.module.js';
import { MembershipsRepository } from './memberships.repository.js';

@Module({
  imports: [PushModule, GroupActivitiesModule, EventSharesDataModule, CalendarFeedsDataModule],
  providers: [MembershipsRepository],
  exports: [MembershipsRepository],
})
export class MembershipsModule {}
