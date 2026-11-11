import { Module } from '@nestjs/common';
import { GroupActivitiesRepository } from './group-activities.repository.js';

/** (#191) 팀 활동 기록. 쓰기 지점(기념일, 멤버십, 팀)과 새 소식이 함께 쓴다 */
@Module({
  providers: [GroupActivitiesRepository],
  exports: [GroupActivitiesRepository],
})
export class GroupActivitiesModule {}
