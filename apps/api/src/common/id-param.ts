import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from './errors.js';

/** MySQL INT 상한. 이보다 큰 값은 어떤 행도 가리킬 수 없으니 형식 오류로 본다 */
const MAX_INT_ID = 2_147_483_647;

/**
 * 경로 파라미터 원문을 양의 정수 ID 로 바꾼다 (api.md 1장 ID, 결정기록 D-35).
 * `0`, 음수, 소수, 지수 표기, 앞자리 0, 숫자 아닌 값, INT 범위 밖은 400 VALIDATION_FAILED (details 에 필드 이름)
 */
export function parseIdParam(field: string, raw: unknown): number {
  const id =
    typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw)
      ? Number(raw)
      : Number.NaN;
  if (!(id <= MAX_INT_ID)) {
    const message = `${field} 은(는) 양의 정수여야 해요`;
    throw new ApiException('VALIDATION_FAILED', message, [{ field, message }]);
  }
  return id;
}

/**
 * `@Param(name)` 대신 쓰는 ID 경로 파라미터. 컨트롤러의 모든 ID 경로 파라미터에 쓴다.
 * `@Param` + 파이프로 두면 전역 ValidationPipe(transform) 가 먼저 `Number('01')`, `Number('1e3')` 로
 * 바꿔 버려 원문 검사가 안 되므로, 요청의 원문을 직접 읽는 커스텀 데코레이터로 둔다
 */
export const IdParam = createParamDecorator(
  (field: string, ctx: ExecutionContext): number =>
    parseIdParam(field, ctx.switchToHttp().getRequest<Request>().params[field]),
);
