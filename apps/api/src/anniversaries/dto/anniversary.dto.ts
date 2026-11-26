import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CALENDAR_KINDS, type CalendarKind } from '../../common/lunar.js';
import { isCalendarDate, Trim } from '../../common/validation.js';
import { AnniversaryKind } from '../../generated/prisma/enums.js';
import {
  ANNIVERSARY_REMINDERS,
  type AnniversaryReminder,
} from '../anniversary-reminders.js';

/** 기념일 종류 (#105, D-62). 계산은 클라이언트, 서버는 저장만 */
export const ANNIVERSARY_KINDS = Object.values(AnniversaryKind);
const KIND_MESSAGE = `종류는 ${ANNIVERSARY_KINDS.join(', ')} 중 하나여야 해요`;
const REMINDERS_MESSAGE = `알림은 ${ANNIVERSARY_REMINDERS.join(', ')} 중에서 골라야 해요`;

/**
 * (#269, D-144) 알림 시점 배열. 생략은 허용(생성은 당일만, 수정은 그대로), null 과 배열이 아닌 값은 거부.
 * `[]` = 알림 없음. 순서 무관, 중복 거부
 */
export function Reminders(): PropertyDecorator {
  return (target, key) => {
    ValidateIf((_: unknown, value: unknown) => value !== undefined)(
      target,
      key,
    );
    IsArray({ message: '알림은 배열이어야 해요' })(target, key);
    ArrayMaxSize(ANNIVERSARY_REMINDERS.length, { message: REMINDERS_MESSAGE })(
      target,
      key,
    );
    ArrayUnique({ message: '알림에 같은 값이 두 번 있어요' })(target, key);
    IsIn(ANNIVERSARY_REMINDERS, { each: true, message: REMINDERS_MESSAGE })(
      target,
      key,
    );
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

/** (#562) 달력 종류 (생략하면 생성은 SOLAR, 수정은 그대로). null 은 거부 */
export function CalendarKindField(): PropertyDecorator {
  return (target, key) => {
    ValidateIf((_: unknown, value: unknown) => value !== undefined)(
      target,
      key,
    );
    IsIn(CALENDAR_KINDS, {
      message: `달력은 ${CALENDAR_KINDS.join(', ')} 중 하나여야 해요`,
    })(target, key);
  };
}

/** (#562) 윤달 여부 (음력일 때만 true 가능, 검사는 서비스) */
export function LeapMonthField(): PropertyDecorator {
  return (target, key) => {
    ValidateIf((_: unknown, value: unknown) => value !== undefined)(
      target,
      key,
    );
    IsBoolean({ message: '윤달은 true 나 false 여야 해요' })(target, key);
  };
}

/**
 * (#562) 기념일 날짜. 양력이면 실제 날짜, 음력이면 1~12월 1~30일 모양만 본다(그 해에 정말 있는지는 서비스가 음력표로 본다).
 * 수정에서 calendar 를 생략하면 기존 값을 모르니 모양만 본다
 */
@ValidatorConstraint({ name: 'anniversaryDate', async: false })
export class AnniversaryDateConstraint implements ValidatorConstraintInterface {
  validate(
    value: unknown,
    args?: { object: object; constraints?: unknown[] },
  ): boolean {
    if (typeof value !== 'string') return false;
    const given = (args?.object as { calendar?: CalendarKind } | undefined)
      ?.calendar;
    const calendar =
      given ??
      (args?.constraints?.[0] as CalendarKind | 'ANY' | undefined) ??
      'SOLAR';
    if (calendar === 'SOLAR') return isCalendarDate(value);
    const [, m, d] = value.split('-').map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= (calendar === 'LUNAR' ? 30 : 31);
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

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '날짜는 YYYY-MM-DD 형식이어야 해요',
  })
  @Validate(AnniversaryDateConstraint, ['SOLAR'])
  date!: string;

  /** 생략하면 COUNT_UP. null 은 IsOptional 과 달리 거부 (컬럼이 NOT NULL) */
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(ANNIVERSARY_KINDS, { message: KIND_MESSAGE })
  kind?: AnniversaryKind;

  @Reminders()
  reminders?: AnniversaryReminder[];

  /** (#562) 생략하면 SOLAR */
  @CalendarKindField()
  calendar?: CalendarKind;

  /** (#562) 생략하면 false */
  @LeapMonthField()
  isLeapMonth?: boolean;
}

export class UpdateAnniversaryDto {
  @IsOptional()
  @Trim()
  @IsString({ message: '기념일 이름은 문자열이어야 해요' })
  @Length(1, 30, { message: '기념일 이름은 1~30자여야 해요' })
  name?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '날짜는 YYYY-MM-DD 형식이어야 해요',
  })
  @Validate(AnniversaryDateConstraint, ['ANY'])
  date?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(ANNIVERSARY_KINDS, { message: KIND_MESSAGE })
  kind?: AnniversaryKind;

  @Reminders()
  reminders?: AnniversaryReminder[];

  /** (#562) 생략하면 그대로. SOLAR 로 바꾸면 윤달은 false 가 된다 */
  @CalendarKindField()
  calendar?: CalendarKind;

  /** (#562) 생략하면 그대로 (양력으로 바꾸면 false) */
  @LeapMonthField()
  isLeapMonth?: boolean;
}
