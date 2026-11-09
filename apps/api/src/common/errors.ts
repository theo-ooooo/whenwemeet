import { HttpException } from '@nestjs/common';

/** api.md 1장 오류 코드 표. KAKAO_NOT_CONFIGURED 는 결정기록 D-29 (로컬에서 카카오 키 없이 기동) */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  EVENT_RANGE_INVALID: 400,
  GROUP_NOT_INVITABLE: 400,
  GROUP_PERSONAL_LEAVE: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVITE_NOT_FOUND: 404,
  INTERNAL: 500,
  KAKAO_ERROR: 502,
  KAKAO_NOT_CONFIGURED: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** 사용자에게 바로 보여도 되는 기본 문구 (한국어 한 문장) */
export const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: '입력값을 확인해 주세요',
  EVENT_RANGE_INVALID: '일정 기간이 올바르지 않아요',
  GROUP_NOT_INVITABLE: '개인 달력에는 초대할 수 없어요',
  GROUP_PERSONAL_LEAVE: '개인 달력은 나갈 수 없어요',
  UNAUTHORIZED: '로그인이 필요해요',
  FORBIDDEN: '이 팀의 멤버가 아니에요',
  NOT_FOUND: '찾을 수 없어요',
  INVITE_NOT_FOUND: '초대 코드를 찾을 수 없어요',
  INTERNAL: '잠시 후 다시 시도해 주세요',
  KAKAO_ERROR: '카카오 연결에 실패했어요. 잠시 후 다시 시도해 주세요',
  KAKAO_NOT_CONFIGURED: '카카오 로그인이 설정되지 않았어요',
};

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

/** 코드가 붙은 예외. 예외 필터가 그대로 `{ error: { code, message } }` 로 내려보낸다 */
export class ApiException extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string = DEFAULT_MESSAGE[code]) {
    super({ error: { code, message } } satisfies ErrorBody, ERROR_STATUS[code]);
    this.code = code;
    this.message = message;
  }
}
