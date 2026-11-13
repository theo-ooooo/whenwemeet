import { Module } from '@nestjs/common';
import { AnniversaryPlanner } from './anniversary-planner.js';
import { ExpoPushClient } from './expo-push.client.js';
import { PushDevicesService } from './push-devices.service.js';
import { NotificationSettingsController, PushDevicesController } from './push.controller.js';
import { PushDispatcher } from './push-dispatcher.js';
import { PushRepository } from './push.repository.js';
import { PushScheduler } from './push.scheduler.js';
import { WeeklyPlanner } from './weekly-planner.js';
import { PollPlanner } from './poll-planner.js';
import { ReminderPlanner } from './reminder-planner.js';
import { NotificationPreferencesModule } from '../notification-preferences/notification-preferences.module.js';

/**
 * 앱 푸시 알림 (#188, 설계 푸시-알림.md). 기기와 설정 API, 30초 틱 예약/발송.
 * PushRepository 는 일정 변경(묶기)과 합류 트랜잭션이 쓰므로 내보낸다. 이 모듈은 다른 도메인 모듈을 import 하지 않는다 (알림 설정 저장소 NotificationPreferencesModule 만, #369)
 */
@Module({
  imports: [NotificationPreferencesModule],
  controllers: [PushDevicesController, NotificationSettingsController],
  providers: [PushRepository, PushDevicesService, ExpoPushClient, ReminderPlanner, AnniversaryPlanner, WeeklyPlanner, PollPlanner, PushDispatcher, PushScheduler],
  exports: [PushRepository, PushScheduler],
})
export class PushModule {}
