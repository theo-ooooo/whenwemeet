import { Injectable } from '@nestjs/common';
import type { CalendarType } from '../generated/prisma/enums.js';
import { toUserRow, USER_PUBLIC_SELECT, type MembershipRow } from '../common/member.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** (#305) 팀 달력에 보이는 생일 한 사람. 멤버 표시(팀 표시 이름 ?? 닉네임, 색) + 'MM-DD'. (#562) 음력 여부와 윤달 */
export interface BirthdayMemberRow extends MembershipRow {
  birthday: string;
  birthdayCalendar: CalendarType;
  birthdayLeapMonth: boolean;
}

/** (#193, #305) 구독 피드용: 이름과 생일, 마지막 개정 시각 */
export interface BirthdayFeedRow {
  userId: number;
  name: string;
  birthday: string;
  /** (#562) 음력 여부와 윤달 */
  birthdayCalendar: CalendarType;
  birthdayLeapMonth: boolean;
  updatedAt: Date;
}

/** 이 팀에 생일을 보이는 멤버: 생일이 있고 그 팀 멤버십의 showBirthday 가 켜짐 (D-231) */
const shownIn = (groupId: number) => ({ groupId, showBirthday: true, user: { birthday: { not: null } } });

/**
 * (#305) 멤버 생일 읽기. 생일은 User 한 칸이라 팀 멤버십을 따라 읽기만 한다 (쓰기는 UsersRepository).
 * 멤버십이 없어지면(팀 나가기, 탈퇴) 그 팀에서 바로 빠진다 (D-230)
 */
@Injectable()
export class BirthdaysRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: FileUrlBuilder,
  ) {}

  /** 가입순 */
  async listShownByGroup(groupId: number): Promise<BirthdayMemberRow[]> {
    const rows = await this.prisma.membership.findMany({
      where: shownIn(groupId),
      orderBy: { joinedAt: 'asc' },
      select: {
        userId: true,
        color: true,
        displayName: true,
        joinedAt: true,
        user: { select: { ...USER_PUBLIC_SELECT.select, birthday: true, birthdayCalendar: true, birthdayLeapMonth: true } },
      },
    });
    return rows.map(({ user: { birthday, birthdayCalendar, birthdayLeapMonth, ...user }, ...row }) => ({
      ...row,
      user: toUserRow(user, this.urls),
      birthday: birthday!,
      birthdayCalendar,
      birthdayLeapMonth,
    }));
  }

  /** (#193) 피드: 기념일 포함이 켜져 있을 때 같이 싣는다 */
  async listForFeed(groupId: number): Promise<BirthdayFeedRow[]> {
    const rows = await this.prisma.membership.findMany({
      where: shownIn(groupId),
      orderBy: { userId: 'asc' },
      select: { userId: true, displayName: true, user: { select: { nickname: true, birthday: true, birthdayCalendar: true, birthdayLeapMonth: true, updatedAt: true } } },
    });
    return rows.map((row) => ({
      userId: row.userId,
      name: row.displayName ?? row.user.nickname,
      birthday: row.user.birthday!,
      birthdayCalendar: row.user.birthdayCalendar,
      birthdayLeapMonth: row.user.birthdayLeapMonth,
      updatedAt: row.user.updatedAt,
    }));
  }
}
