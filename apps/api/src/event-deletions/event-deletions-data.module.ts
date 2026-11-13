import { Module } from '@nestjs/common';
import { EventDeletionsRepository } from './event-deletions.repository.js';

/** (#375) 일정 삭제 되돌리기 보관 저장소. 하루 청소(PushModule 틱)가 쓴다. 보관, 복원은 일정 트랜잭션 안의 함수로 (D-251) */
@Module({
  providers: [EventDeletionsRepository],
  exports: [EventDeletionsRepository],
})
export class EventDeletionsDataModule {}
