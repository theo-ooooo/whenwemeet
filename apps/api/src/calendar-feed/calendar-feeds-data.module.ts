import { Module } from '@nestjs/common';
import { CalendarFeedsRepository } from './calendar-feeds.repository.js';

/** (#193) 구독 주소 저장소. 설정 API, 공개 피드와 함께 팀 나가기, 탈퇴(멤버십)가 주소 삭제에 쓴다 */
@Module({
  providers: [CalendarFeedsRepository],
  exports: [CalendarFeedsRepository],
})
export class CalendarFeedsDataModule {}
