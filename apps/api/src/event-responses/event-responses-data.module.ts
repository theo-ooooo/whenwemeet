import { Module } from '@nestjs/common';
import { GroupActivitiesModule } from '../group-activities/group-activities.module.js';
import { EventResponsesRepository } from './event-responses.repository.js';

/** (#190) 참석 여부, 반응 저장소. 일정 목록, 단건(집계)과 응답 API 가 같이 쓴다 */
@Module({
  imports: [GroupActivitiesModule],
  providers: [EventResponsesRepository],
  exports: [EventResponsesRepository],
})
export class EventResponsesDataModule {}
