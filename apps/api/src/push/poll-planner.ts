import { Injectable } from '@nestjs/common';
import { pollDeadlinePayload } from './push-copy.js';
import { PushRepository } from './push.repository.js';

/** 한 틱에 집는 마감 투표 수 */
export const POLL_DEADLINE_LIMIT = 200;

/**
 * (#189) 약속 투표 마감 (설계 약속-투표.md 5장, D-241). 30초 틱이 임대를 얻었을 때 부른다.
 * `status = OPEN AND deadline <= now AND deadlineNotifiedAt IS NULL` 을 집어 표시하고 연 사람에게 알림 1건을 예약한다.
 * 늦게 집은 것(틱이 꺼져 있던 동안)은 예약 시각이 마감이라 펼칠 때 10분 규칙으로 SKIPPED (D-88). 자동으로 정하지는 않는다 (Q3)
 */
@Injectable()
export class PollPlanner {
  constructor(private readonly push: PushRepository) {}

  /** 이번 틱에 예약한 마감 알림 수 */
  async plan(now: Date): Promise<number> {
    const due = await this.push.listDuePollDeadlines(now, POLL_DEADLINE_LIMIT);
    let scheduled = 0;
    for (const poll of due) {
      const payload = pollDeadlinePayload({ groupName: poll.groupName, groupCode: poll.groupCode, pollCode: poll.pollCode, title: poll.title }, now);
      if (await this.push.schedulePollDeadline(poll, payload, now)) scheduled += 1;
    }
    return scheduled;
  }
}
