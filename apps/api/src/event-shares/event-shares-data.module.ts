import { Module } from '@nestjs/common';
import { EventSharesRepository } from './event-shares.repository.js';

/** (#274) 일정 공유 링크 저장소. 공유 API 와 함께 초대 코드 재발급(팀), 나가기/탈퇴(멤버십)가 끊기에 쓴다 */
@Module({
  providers: [EventSharesRepository],
  exports: [EventSharesRepository],
})
export class EventSharesDataModule {}
