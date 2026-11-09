import { HttpException } from '@nestjs/common';

/** api.md 1장 오류 코드 표. KAKAO_NOT_CONFIGURED 는 결정기록 D-29 (로컬에서 카카오 키 없이 기동), STORAGE_NOT_CONFIGURED 는 R2 키 없이 기동 (#32), PAYLOAD_TOO_LARGE 는 JSON 본문 크기 초과 (#60) */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  EVENT_RANGE_INVALID: 400,
  GROUP_NOT_INVITABLE: 400,
  GROUP_PERSONAL_LEAVE: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVITE_NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
  KAKAO_ERROR: 502,
  KAKAO_NOT_CONFIGURED: 503,
  STORAGE_NOT_CONFIGURED: 503,
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
  PAYLOAD_TOO_LARGE: '요청 내용이 너무 커요',
  INTERNAL: '잠시 후 다시 시도해 주세요',
  KAKAO_ERROR: '카카오 연결에 실패했어요. 잠시 후 다시 시도해 주세요',
  KAKAO_NOT_CONFIGURED: '카카오 로그인이 설정되지 않았어요',
  STORAGE_NOT_CONFIGURED: '사진 업로드를 지금 사용할 수 없어요',
};

/** 검증 실패 시 필드별 위반 항목 (api.md 1장 `error.details`) */
export interface FieldViolation {
  field: string;
  message: string;
}

/** 실패 응답 봉투 (api.md 1장, 결정기록 D-33). `status` 는 HTTP 상태 코드와 같다 */
export interface ErrorBody {
  status: number;
  data: null;
  message: string;
  error: { code: ErrorCode; details?: FieldViolation[] };
}

/** 코드가 붙은 예외. 예외 필터가 `{ status, data: null, message, error: { code, details? } }` 로 내려보낸다 */
export class ApiException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: FieldViolation[];

  constructor(code: ErrorCode, message: string = DEFAULT_MESSAGE[code], details?: FieldViolation[]) {
    super(message, ERROR_STATUS[code]);
    this.code = code;
    this.details = details;
  }

  /** 응답 본문. details 가 없으면 키 자체를 빼서 성공/실패 어느 쪽도 undefined 키를 내리지 않는다 */
  toBody(): ErrorBody {
    const error: ErrorBody['error'] = { code: this.code };
    if (this.details) error.details = this.details;
    return { status: this.getStatus(), data: null, message: this.message, error };
  }
}
