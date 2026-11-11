import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, Length, Matches, Validate, ValidateIf, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { isCalendarDate, Trim } from '../../common/validation.js';
import { AnniversaryKind } from '../../generated/prisma/enums.js';
import { ANNIVERSARY_REMINDERS, type AnniversaryReminder } from '../anniversary-reminders.js';

/** 기념일 종류 (#105, D-62). 계산은 클라이언트, 서버는 저장만 */
export const ANNIVERSARY_KINDS = Object.values(AnniversaryKind);
const KIND_MESSAGE = `종류는 ${ANNIVERSARY_KINDS.join(', ')} 중 하나여야 해요`;
const REMINDERS_MESSAGE = `알림은 ${ANNIVERSARY_REMINDERS.join(', ')} 중에서 골라야 해요`;

/**
 * (#269, D-143) 알림 시점 배열. 생략은 허용(생성은 당일만, 수정은 그대로), null 과 배열이 아닌 값은 거부.
 * `[]` = 알림 없음. 순서 무관, 중복 거부
 */
function Reminders(): PropertyDecorator {
  return (target, key) => {
    ValidateIf((_: unknown, value: unknown) => value !== undefined)(target, key);
    IsArray({ message: '알림은 배열이어야 해요' })(target, key);
    ArrayMaxSize(ANNIVERSARY_REMINDERS.length, { message: REMINDERS_MESSAGE })(target, key);
    ArrayUnique({ message: '알림에 같은 값이 두 번 있어요' })(target, key);
    IsIn(ANNIVERSARY_REMINDERS, { each: true, message: REMINDERS_MESSAGE })(target, key);
  };
}

@ValidatorConstraint({ name: 'calendarDate', async: false })
export class CalendarDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isCalendarDate(value);
  }

  defaultMessage(): string {
    return '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 해요';
  }
}

export class CreateAnniversaryDto {
  @Trim()
  @IsString({ message: '기념일 이름은 문자열이어야 해요' })
  @Length(1, 30, { message: '기념일 이름은 1~30자여야 해요' })
  name!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '날짜는 YYYY-MM-DD 형식이어야 해요' })
  @Validate(CalendarDateConstraint)
  date!: string;

  /** 생략하면 COUNT_UP. null 은 IsOptional 과 달리 거부 (컬럼이 NOT NULL) */
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(ANNIVERSARY_KINDS, { message: KIND_MESSAGE })
  kind?: AnniversaryKind;

  @Reminders()
  reminders?: AnniversaryReminder[];
}

export class UpdateAnniversaryDto {
  @IsOptional()
  @Trim()
  @IsString({ message: '기념일 이름은 문자열이어야 해요' })
  @Length(1, 30, { message: '기념일 이름은 1~30자여야 해요' })
  name?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '날짜는 YYYY-MM-DD 형식이어야 해요' })
  @Validate(CalendarDateConstraint)
  date?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(ANNIVERSARY_KINDS, { message: KIND_MESSAGE })
  kind?: AnniversaryKind;

  @Reminders()
  reminders?: AnniversaryReminder[];
}
