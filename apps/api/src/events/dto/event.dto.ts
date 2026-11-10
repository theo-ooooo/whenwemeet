import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength, Validate } from 'class-validator';
import { IsIsoDateTime, Trim } from '../../common/validation.js';
import { CalendarDateConstraint } from '../../anniversaries/dto/anniversary.dto.js';
import { REPEATS, type Repeat } from '../recurrence.js';

const REPEAT_MESSAGE = `repeat 는 ${REPEATS.join(', ')} 중 하나여야 해요`;

export class EventInputDto {
  @Trim()
  @IsString({ message: '제목은 문자열이어야 해요' })
  @Length(1, 50, { message: '제목은 1~50자여야 해요' })
  title!: string;

  @IsIsoDateTime('startsAt 은')
  startsAt!: string;

  @IsIsoDateTime('endsAt 은')
  endsAt!: string;

  @IsBoolean({ message: 'allDay 는 true/false 여야 해요' })
  allDay!: boolean;

  @IsOptional()
  @IsString({ message: '메모는 문자열이어야 해요' })
  @MaxLength(500, { message: '메모는 500자 이하여야 해요' })
  memo?: string;

  /** (#187) 생략/null 이면 한 번짜리 (PATCH 에서 생략은 그대로, null 은 반복 끄기) */
  @IsOptional()
  @IsIn(REPEATS, { message: REPEAT_MESSAGE })
  repeat?: Repeat | null;

  /** (#187) 반복 종료일 'YYYY-MM-DD' (KST, 그날 시작하는 회차 포함). 생략/null 이면 계속 */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'repeatUntil 은 YYYY-MM-DD 형식이어야 해요' })
  @Validate(CalendarDateConstraint)
  repeatUntil?: string | null;
}

export class EventPatchDto {
  @IsOptional()
  @Trim()
  @IsString({ message: '제목은 문자열이어야 해요' })
  @Length(1, 50, { message: '제목은 1~50자여야 해요' })
  title?: string;

  @IsOptional()
  @IsIsoDateTime('startsAt 은')
  startsAt?: string;

  @IsOptional()
  @IsIsoDateTime('endsAt 은')
  endsAt?: string;

  @IsOptional()
  @IsBoolean({ message: 'allDay 는 true/false 여야 해요' })
  allDay?: boolean;

  @IsOptional()
  @IsString({ message: '메모는 문자열이어야 해요' })
  @MaxLength(500, { message: '메모는 500자 이하여야 해요' })
  memo?: string;

  /** (#187) 생략/null 이면 한 번짜리 (PATCH 에서 생략은 그대로, null 은 반복 끄기) */
  @IsOptional()
  @IsIn(REPEATS, { message: REPEAT_MESSAGE })
  repeat?: Repeat | null;

  /** (#187) 반복 종료일 'YYYY-MM-DD' (KST, 그날 시작하는 회차 포함). 생략/null 이면 계속 */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'repeatUntil 은 YYYY-MM-DD 형식이어야 해요' })
  @Validate(CalendarDateConstraint)
  repeatUntil?: string | null;
}

export class EventRangeQueryDto {
  @IsIsoDateTime('from 은')
  from!: string;

  @IsIsoDateTime('to 는')
  to!: string;
}
