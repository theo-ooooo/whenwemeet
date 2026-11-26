import { Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { isBirthday } from '../../anniversaries/birthdays.js';
import type { AnniversaryReminder } from '../../anniversaries/anniversary-reminders.js';
import { CalendarKindField, LeapMonthField, Reminders } from '../../anniversaries/dto/anniversary.dto.js';
import type { CalendarKind } from '../../common/lunar.js';

@ValidatorConstraint({ name: 'birthday', async: false })
export class BirthdayConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args?: { object: object }): boolean {
    const calendar = (args?.object as { calendar?: CalendarKind } | undefined)?.calendar ?? 'SOLAR';
    return value === null || isBirthday(value, calendar);
  }

  defaultMessage(): string {
    return '생일은 MM-DD 형식의 실제 날짜여야 해요';
  }
}

/**
 * PATCH /me/birthday (#305, D-230). date 는 필수 키: 'MM-DD'(2월 29일 허용) 또는 null(지우기).
 * reminders 는 팀원에게 알리는 시점. 생략하면 그대로 (처음엔 당일만, D-232).
 * (#562, D-297) calendar 생략은 SOLAR, LUNAR 면 date 가 음력 월일(1~30일). isLeapMonth 는 음력일 때만 true (생략 false)
 */
export class UpdateBirthdayDto {
  @Validate(BirthdayConstraint)
  date!: string | null;

  @Reminders()
  reminders?: AnniversaryReminder[];

  @CalendarKindField()
  calendar?: CalendarKind;

  @LeapMonthField()
  isLeapMonth?: boolean;
}
