import { Injectable } from '@nestjs/common';
import type { CalendarType } from '../generated/prisma/enums.js';
import { type Member, toMember } from '../common/member.js';
import { MembershipService } from '../groups/membership.service.js';
import { BirthdaysRepository } from './birthdays.repository.js';

/** (#305) GET /groups/:groupId/birthdays 한 줄 */
export interface BirthdayView {
  /** 팀 안의 표시 이름과 색 (Membership.displayName ?? 닉네임) */
  member: Member;
  /** 'MM-DD'. 연도 없음. (#562) LUNAR 면 음력 월일 */
  date: string;
  /** (#562) 달력 종류와 윤달 (D-297) */
  calendar: CalendarType;
  isLeapMonth: boolean;
}

@Injectable()
export class BirthdaysService {
  constructor(
    private readonly birthdays: BirthdaysRepository,
    private readonly memberships: MembershipService,
  ) {}

  /** 이 팀에 생일을 보이는 멤버 (나 포함, 개인 팀이면 나만). 가입순 */
  async list(userId: number, groupId: number): Promise<BirthdayView[]> {
    await this.memberships.assertMember(userId, groupId);
    const rows = await this.birthdays.listShownByGroup(groupId);
    return rows.map((row) => {
      const { joinedAt: _joinedAt, ...member } = toMember(row);
      return { member, date: row.birthday, calendar: row.birthdayCalendar, isLeapMonth: row.birthdayLeapMonth };
    });
  }
}
