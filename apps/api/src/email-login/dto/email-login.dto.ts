import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateBy,
} from 'class-validator';
import { Trim } from '../../common/validation.js';
import {
  CODE_PATTERN,
  EMAIL_MAX_LENGTH,
  isAcceptableEmail,
  normalizeEmail,
} from '../email-crypto.js';

export const EMAIL_LOGIN_CLIENTS = ['web', 'app'] as const;
/** (#198) 이메일 메일의 쓰임 */
export const EMAIL_PURPOSES = ['LOGIN', 'LINK'] as const;

/** 앞뒤 공백 제거 + 소문자 → ASCII `로컬@도메인.최상위`, 191자 이하 (D-110) */
export function EmailAddress(): PropertyDecorator {
  return (target, key) => {
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeEmail(value) : value,
    )(target, key);
    ValidateBy(
      {
        name: 'emailAddress',
        validator: {
          validate: (value: unknown) =>
            typeof value === 'string' && isAcceptableEmail(value),
          defaultMessage: () =>
            `이메일 주소를 다시 확인해 주세요 (${EMAIL_MAX_LENGTH}자 이하)`,
        },
      },
      {},
    )(target, key);
  };
}

/** 웹이 UA 로 정한 호출 화면. "app" 이면 User.lastAppLoginAt 갱신 (4-1). 없으면 web */
function ClientField(): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    IsIn(EMAIL_LOGIN_CLIENTS, {
      message: 'client 는 web 또는 app 이어야 해요',
    })(target, key);
  };
}

/** POST /auth/email/request */
export class EmailRequestDto {
  @EmailAddress()
  email!: string;

  /** 로그인 후 갈 경로. 서비스가 sanitizeNext 로 다시 거른다 */
  @IsOptional()
  @IsString({ message: 'next 는 문자열이어야 해요' })
  next?: string;

  /** (#198) LINK 면 로그인한 사용자의 이메일 연결 (Authorization 필요, D-257). 없으면 LOGIN */
  @IsOptional()
  @IsIn(EMAIL_PURPOSES, { message: 'purpose 는 LOGIN 또는 LINK 여야 해요' })
  purpose?: (typeof EMAIL_PURPOSES)[number];
}

/** POST /auth/email/link/inspect. 형식이 틀린 토큰은 400 대신 INVALID 로 답한다 */
export class EmailLinkInspectDto {
  @IsString({ message: 'token 은 문자열이어야 해요' })
  @MaxLength(256, { message: 'token 이 너무 길어요' })
  token!: string;
}

/** POST /auth/email/link. 형식이 틀린 토큰은 EMAIL_LINK_INVALID { reason: INVALID } */
export class EmailLinkDto {
  @IsString({ message: 'token 은 문자열이어야 해요' })
  @MaxLength(256, { message: 'token 이 너무 길어요' })
  token!: string;

  @ClientField()
  client?: (typeof EMAIL_LOGIN_CLIENTS)[number];
}

/** POST /auth/email/code */
export class EmailCodeDto {
  @EmailAddress()
  email!: string;

  @IsString({ message: '코드는 문자열이어야 해요' })
  @Matches(CODE_PATTERN, { message: '코드는 6자리 숫자여야 해요' })
  code!: string;

  @ClientField()
  client?: (typeof EMAIL_LOGIN_CLIENTS)[number];
}

/** POST /auth/email/signup. 가입 닉네임은 2~20자 (D-114. PATCH /me 의 1~20자는 그대로) */
export class EmailSignupDto {
  @IsString({ message: 'signupToken 은 문자열이어야 해요' })
  @MaxLength(256, { message: 'signupToken 이 너무 길어요' })
  signupToken!: string;

  @Trim()
  @IsString({ message: '닉네임은 문자열이어야 해요' })
  @Length(2, 20, { message: '닉네임은 2~20자여야 해요' })
  nickname!: string;

  @ClientField()
  client?: (typeof EMAIL_LOGIN_CLIENTS)[number];
}
