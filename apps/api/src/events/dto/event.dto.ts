import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Validate,
  ValidateIf,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { paletteColorOf } from '../../common/member.js';
import { IsIsoDateTime, Trim } from '../../common/validation.js';
import { CalendarDateConstraint } from '../../anniversaries/dto/anniversary.dto.js';
import { EVENT_REMINDERS, type EventReminder } from '../../push/remind-at.js';
import {
  type ParticipantsInput,
  participantsProblem,
} from '../participants.js';
import { type PlaceInput, placeProblem } from '../place.js';
import { REPEATS, type Repeat } from '../recurrence.js';

const REPEAT_MESSAGE = `repeat 는 ${REPEATS.join(', ')} 중 하나여야 해요`;
const REMINDER_MESSAGE = `reminder 는 ${EVENT_REMINDERS.join(', ')} 중 하나여야 해요`;

/** (#248) participants: 'ALL' 또는 양의 정수 1~50개 배열 (설계 3-2). null 도 형식 오류 */
@ValidatorConstraint({ name: 'participants', async: false })
export class ParticipantsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return participantsProblem(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return participantsProblem(args.value) ?? '';
  }
}

/** (#199) place: 객체 { name, address?, lat?, lng?, kakaoPlaceId? } 또는 null (지우기) */
@ValidatorConstraint({ name: 'place', async: false })
export class PlaceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return placeProblem(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return placeProblem(args.value) ?? '';
  }
}

/** (#343) 일정 색 오류 문구 (D-215) */
export const EVENT_COLOR_MESSAGE = '색은 정해진 8색 중 하나여야 해요';

/** (#343) color: 팔레트 키 8개 중 하나 (대소문자 무시). null 은 자동이라 이 검사 전에 거른다 */
@ValidatorConstraint({ name: 'eventColor', async: false })
export class EventColorConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return paletteColorOf(value) !== null;
  }

  defaultMessage(): string {
    return EVENT_COLOR_MESSAGE;
  }
}

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
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'repeatUntil 은 YYYY-MM-DD 형식이어야 해요',
  })
  @Validate(CalendarDateConstraint)
  repeatUntil?: string | null;

  /** (#188) 알림 시각 (D-84). 생성에서 생략하면 NONE, 수정에서 생략하면 그대로. 종일 여부와 안 맞으면 400 */
  @IsOptional()
  @IsIn(EVENT_REMINDERS, { message: REMINDER_MESSAGE })
  reminder?: EventReminder;

  /** (#248) 참여자 (설계 3-2). 생성에서 생략하면 [요청자], 수정에서 생략하면 그대로. 멤버 여부는 저장 트랜잭션 안에서 */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(ParticipantsConstraint)
  participants?: ParticipantsInput;

  /** (#343) 일정 색 (D-215). 팔레트 키 8개 중 하나, null 이면 자동(참여자 색). 생성에서 생략하면 null, 수정에서 생략하면 그대로 */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Validate(EventColorConstraint)
  color?: string | null;

  /** (#199) 장소 (D-242). 생성에서 생략하면 없음, 수정에서 생략하면 그대로, null 이면 지우기. 반복은 "이 일정만" 으로도 바꿀 수 있다 */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(PlaceConstraint)
  place?: PlaceInput;

  /** (#566) 날짜를 음력으로 골라 넣었는지 (D-298). 생성에서 생략하면 false, 수정에서 생략하면 그대로. 반복은 원본 단위("이 일정만" 이면 400) */
  @IsOptional()
  @IsBoolean({ message: 'lunarInput 은 true/false 여야 해요' })
  lunarInput?: boolean;
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
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'repeatUntil 은 YYYY-MM-DD 형식이어야 해요',
  })
  @Validate(CalendarDateConstraint)
  repeatUntil?: string | null;

  /** (#188) 알림 시각 (D-84). 생성에서 생략하면 NONE, 수정에서 생략하면 그대로. 종일 여부와 안 맞으면 400 */
  @IsOptional()
  @IsIn(EVENT_REMINDERS, { message: REMINDER_MESSAGE })
  reminder?: EventReminder;

  /** (#248) 참여자 (설계 3-2). 생성에서 생략하면 [요청자], 수정에서 생략하면 그대로. 멤버 여부는 저장 트랜잭션 안에서 */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(ParticipantsConstraint)
  participants?: ParticipantsInput;

  /** (#343) 일정 색 (D-215). 팔레트 키 8개 중 하나, null 이면 자동(참여자 색). 생성에서 생략하면 null, 수정에서 생략하면 그대로 */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Validate(EventColorConstraint)
  color?: string | null;

  /** (#199) 장소 (D-242). 생성에서 생략하면 없음, 수정에서 생략하면 그대로, null 이면 지우기. 반복은 "이 일정만" 으로도 바꿀 수 있다 */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(PlaceConstraint)
  place?: PlaceInput;

  /** (#566) 날짜를 음력으로 골라 넣었는지 (D-298). 생성에서 생략하면 false, 수정에서 생략하면 그대로. 반복은 원본 단위("이 일정만" 이면 400) */
  @IsOptional()
  @IsBoolean({ message: 'lunarInput 은 true/false 여야 해요' })
  lunarInput?: boolean;
}

export class EventRangeQueryDto {
  @IsIsoDateTime('from 은')
  from!: string;

  @IsIsoDateTime('to 는')
  to!: string;
}
