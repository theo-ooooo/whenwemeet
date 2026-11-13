import { Controller, Get } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { BirthdaysService } from './birthdays.service.js';

/** (#305) 팀 달력에 보이는 멤버 생일. 쓰기는 내 정보(PATCH /me/birthday)와 팀 설정(PATCH /groups/:id/me showBirthday) */
@Controller('groups/:groupId/birthdays')
export class BirthdaysController {
  constructor(private readonly birthdays: BirthdaysService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.birthdays.list(user.id, groupId);
  }
}
