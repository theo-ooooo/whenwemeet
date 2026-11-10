import { IsIn, IsOptional, IsString, Length, Matches, Validate, ValidateIf, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { isCalendarDate, Trim } from '../../common/validation.js';
import { AnniversaryKind } from '../../generated/prisma/enums.js';

/** 기념일 종류 (#105, D-62). 계산은 클라이언트, 서버는 저장만 */
export const ANNIVERSARY_KINDS = Object.values(AnniversaryKind);
const KIND_MESSAGE = `종류는 ${ANNIVERSARY_KINDS.join(', ')} 중 하나여야 해요`;

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
}
