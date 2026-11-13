import { Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { isBirthday } from '../../anniversaries/birthdays.js';
import type { AnniversaryReminder } from '../../anniversaries/anniversary-reminders.js';
import { Reminders } from '../../anniversaries/dto/anniversary.dto.js';

@ValidatorConstraint({ name: 'birthday', async: false })
export class BirthdayConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return value === null || isBirthday(value);
  }

  defaultMessage(): string {
    return '생일은 MM-DD 형식의 실제 날짜여야 해요';
  }
}

/**
 * PATCH /me/birthday (#305, D-224). date 는 필수 키: 'MM-DD'(2월 29일 허용) 또는 null(지우기).
 * reminders 는 팀원에게 알리는 시점. 생략하면 그대로 (처음엔 당일만, D-226)
 */
export class UpdateBirthdayDto {
  @Validate(BirthdayConstraint)
  date!: string | null;

  @Reminders()
  reminders?: AnniversaryReminder[];
}
