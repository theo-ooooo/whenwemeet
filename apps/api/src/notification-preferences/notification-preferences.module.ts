import { Module } from '@nestjs/common';
import { NotificationPreferencesRepository } from './notification-preferences.repository.js';

/** (#369) 알림 설정 저장소. 설정 API(PushModule)와 내 생일(UsersModule)이 같이 쓴다 */
@Module({
  providers: [NotificationPreferencesRepository],
  exports: [NotificationPreferencesRepository],
})
export class NotificationPreferencesModule {}
