import { HttpException } from '@nestjs/common';

/** api.md 1장 오류 코드 표. KAKAO_NOT_CONFIGURED 는 결정기록 D-29 (로컬에서 카카오 키 없이 기동), STORAGE_NOT_CONFIGURED 는 R2 키 없이 기동 (#32), PAYLOAD_TOO_LARGE 는 JSON 본문 크기 초과 (#60), DB_UNAVAILABLE 은 health 의 DB 확인 실패 (#50), SOCIAL_TOKEN_INVALID, HANDOFF_INVALID, APPLE_* 는 앱과 애플 로그인 (앱.md 8장), EMAIL_*, SIGNUP_TOKEN_INVALID 는 이메일 로그인 (#245, 이메일-로그인.md 4-3), RATE_LIMITED 는 요청 제한 (#186) */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  EVENT_RANGE_INVALID: 400,
  GROUP_NOT_INVITABLE: 400,
  GROUP_PERSONAL_LEAVE: 400,
  EMAIL_LINK_INVALID: 400,
  EMAIL_CODE_INVALID: 400,
  EMAIL_CODE_LOCKED: 400,
  EMAIL_CODE_EXPIRED: 400,
  UNAUTHORIZED: 401,
  SOCIAL_TOKEN_INVALID: 401,
  HANDOFF_INVALID: 401,
  SIGNUP_TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVITE_NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  EMAIL_RATE_LIMITED: 429,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  KAKAO_ERROR: 502,
  APPLE_ERROR: 502,
  KAKAO_NOT_CONFIGURED: 503,
  APPLE_NOT_CONFIGURED: 503,
  STORAGE_NOT_CONFIGURED: 503,
  DB_UNAVAILABLE: 503,
  EMAIL_NOT_CONFIGURED: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** 사용자에게 바로 보여도 되는 기본 문구 (한국어 한 문장) */
export const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: '입력값을 확인해 주세요',
  EVENT_RANGE_INVALID: '일정 기간이 올바르지 않아요',
  GROUP_NOT_INVITABLE: '개인 달력에는 초대할 수 없어요',
  GROUP_PERSONAL_LEAVE: '개인 달력은 나갈 수 없어요',
  EMAIL_LINK_INVALID: '로그인 링크를 쓸 수 없어요',
  EMAIL_CODE_INVALID: '코드가 맞지 않아요',
  EMAIL_CODE_LOCKED: '코드를 5번 틀렸어요. 메일을 다시 받아 주세요',
  EMAIL_CODE_EXPIRED: '코드가 만료됐어요. 메일을 다시 받아 주세요',
  UNAUTHORIZED: '로그인이 필요해요',
  SOCIAL_TOKEN_INVALID: '로그인 정보를 확인하지 못했어요. 다시 시도해 주세요',
  HANDOFF_INVALID: '로그인이 만료됐어요. 다시 시도해 주세요',
  SIGNUP_TOKEN_INVALID: '가입 시간이 지났어요. 다시 시작해 주세요',
  FORBIDDEN: '이 팀의 멤버가 아니에요',
  NOT_FOUND: '찾을 수 없어요',
  INVITE_NOT_FOUND: '초대 코드를 찾을 수 없어요',
  PAYLOAD_TOO_LARGE: '요청 내용이 너무 커요',
  EMAIL_RATE_LIMITED: '잠시 후 다시 보내 주세요',
  RATE_LIMITED: '잠시 후 다시 시도해 주세요',
  INTERNAL: '잠시 후 다시 시도해 주세요',
  KAKAO_ERROR: '카카오 연결에 실패했어요. 잠시 후 다시 시도해 주세요',
  KAKAO_NOT_CONFIGURED: '카카오 로그인이 설정되지 않았어요',
  APPLE_ERROR: 'Apple 연결에 실패했어요. 잠시 후 다시 시도해 주세요',
  APPLE_NOT_CONFIGURED: 'Apple 로그인이 설정되지 않았어요',
  STORAGE_NOT_CONFIGURED: '사진 업로드를 지금 사용할 수 없어요',
  DB_UNAVAILABLE: '서버를 점검하고 있어요. 잠시 후 다시 시도해 주세요',
  EMAIL_NOT_CONFIGURED: '지금은 이메일로 로그인할 수 없어요',
};

/** 검증 실패 시 필드별 위반 항목 (api.md 1장 `error.details`) */
export interface FieldViolation {
  field: string;
  message: string;
}

/**
 * `error.details` 의 모양. 검증 실패는 필드별 위반 목록, 이메일 로그인 오류는 이유 객체
 * (`{ reason, retryAfterSec }`, `{ reason }`, `{ attemptsLeft }`, 이메일-로그인.md 4-3)
 */
export type ErrorDetails = FieldViolation[] | Record<string, string | number>;

/** 실패 응답 봉투 (api.md 1장, 결정기록 D-33). `status` 는 HTTP 상태 코드와 같다 */
export interface ErrorBody {
  status: number;
  data: null;
  message: string;
  error: { code: ErrorCode; details?: ErrorDetails };
}

/** 코드가 붙은 예외. 예외 필터가 `{ status, data: null, message, error: { code, details? } }` 로 내려보낸다 */
export class ApiException extends HttpException {
  readonly code: ErrorCode;
  /** 검증 실패의 필드별 위반 목록 */
  readonly details?: FieldViolation[];
  /** 이메일 로그인 오류의 이유 객체 (#245). 응답에서는 같은 `error.details` 자리에 실린다 */
  readonly reason?: Record<string, string | number>;

  constructor(code: ErrorCode, message: string = DEFAULT_MESSAGE[code], details?: ErrorDetails) {
    super(message, ERROR_STATUS[code]);
    this.code = code;
    if (Array.isArray(details)) this.details = details;
    else if (details) this.reason = details;
  }

  /** 응답 본문. details 가 없으면 키 자체를 빼서 성공/실패 어느 쪽도 undefined 키를 내리지 않는다 */
  toBody(): ErrorBody {
    const error: ErrorBody['error'] = { code: this.code };
    const details = this.details ?? this.reason;
    if (details) error.details = details;
    return { status: this.getStatus(), data: null, message: this.message, error };
  }
}

/**
 * (#186) 요청 제한 초과. `details: { retryAfterSec }` 와 `Retry-After` 헤더로 내려간다.
 * `redirectTo` 가 있으면(브라우저가 직접 여는 로그인 경로) 예외 필터가 JSON 대신 그 주소로 302
 */
export class RateLimitedException extends ApiException {
  readonly retryAfterSec: number;
  readonly redirectTo?: string;

  constructor(retryAfterSec: number, redirectTo?: string) {
    super('RATE_LIMITED', undefined, { retryAfterSec });
    this.retryAfterSec = retryAfterSec;
    if (redirectTo) this.redirectTo = redirectTo;
  }
}
