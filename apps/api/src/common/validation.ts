import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiException } from './errors.js';

/**
 * 한 속성에 위반이 여럿이면 형식 오류를 먼저 말한다 ("abc" 에 "720 이하" 라고 하지 않도록).
 * class-validator 는 데코레이터를 아래에서 위로 평가해 constraints 순서가 읽는 순서와 반대다
 */
const CONSTRAINT_PRIORITY = [
  'whitelistValidation',
  'isDefined',
  'isString',
  'isInt',
  'isNumber',
  'isBoolean',
  'isDateString',
  'matches',
  'calendarDate',
];

/** 검증 실패 목록에서 첫 번째 위반 항목의 문구를 고른다 (api.md: message 는 첫 번째 위반 항목) */
export function firstValidationMessage(errors: ValidationError[]): string {
  for (const error of errors) {
    const entries = Object.entries(error.constraints ?? {}).sort(([a], [b]) => rank(a) - rank(b));
    for (const [key, text] of entries) {
      if (key === 'whitelistValidation') return `${error.property} 은(는) 허용되지 않는 항목이에요`;
      return text;
    }
    if (error.children?.length) {
      const nested = firstValidationMessage(error.children);
      if (nested) return nested;
    }
  }
  return '입력값을 확인해 주세요';
}

function rank(constraint: string): number {
  const index = CONSTRAINT_PRIORITY.indexOf(constraint);
  return index === -1 ? CONSTRAINT_PRIORITY.length : index;
}

/** 전역 ValidationPipe. whitelist + transform + forbidNonWhitelisted (agents/backend.md) */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => new ApiException('VALIDATION_FAILED', firstValidationMessage(errors)),
  });
}

/** `YYYY-MM-DD` 가 실제 달력 날짜인지 (2026-02-30 같은 값 거부) */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** ISO 문자열을 Date 로. 파싱 불가면 VALIDATION_FAILED */
export function parseIsoDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiException('VALIDATION_FAILED', `${field} 은(는) ISO 8601 날짜시각이어야 해요`);
  }
  return date;
}
