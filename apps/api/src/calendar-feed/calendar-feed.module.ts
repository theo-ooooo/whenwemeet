import { Module } from '@nestjs/common';
import { PlacesModule } from '../places/places.module.js';
import { AnniversariesModule } from '../anniversaries/anniversaries.module.js';
import { EventsModule } from '../events/events.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { CalendarFeedPublicController, CalendarFeedSettingsController } from './calendar-feed.controller.js';
import { CalendarFeedService } from './calendar-feed.service.js';
import { CalendarFeedsDataModule } from './calendar-feeds-data.module.js';

/** (#193) 외부 캘린더 구독 (ICS 피드, D-217 ~ D-220) */
@Module({
  imports: [GroupsModule, EventsModule, AnniversariesModule, CalendarFeedsDataModule, PlacesModule],
  controllers: [CalendarFeedSettingsController, CalendarFeedPublicController],
  providers: [CalendarFeedService],
})
export class CalendarFeedModule {}
