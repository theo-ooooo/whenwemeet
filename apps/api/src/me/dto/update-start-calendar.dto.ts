import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { START_CALENDAR_MODES, type StartCalendarMode } from '../../users/users.repository.js';

/**
 * PATCH /me/start-calendar (#300, D-191). mode 와 groupId 의 짝은 Service 가 본다
 * (GROUP 이면 groupId 필수, 그 밖이면 groupId 없음 또는 null)
 */
export class UpdateStartCalendarDto {
  @IsIn(START_CALENDAR_MODES, { message: '처음 여는 달력 값이 올바르지 않아요' })
  mode!: StartCalendarMode;

  @IsOptional()
  @IsInt({ message: '팀 ID 는 정수여야 해요' })
  @Min(1, { message: '팀 ID 는 1 이상이어야 해요' })
  groupId?: number | null;
}
