import { IsOptional, IsString, Length, Matches, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { isCalendarDate, Trim } from '../../common/validation.js';

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
}
