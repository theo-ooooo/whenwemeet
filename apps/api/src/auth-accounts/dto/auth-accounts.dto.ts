import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { EmailAddress } from '../../email-login/dto/email-login.dto.js';
import { CODE_PATTERN } from '../../email-login/email-crypto.js';
import { HANDOFF_LENGTH } from '../../auth/pkce.js';

/** 연결할 수 있는 제공자 (D-257) */
export const LINKABLE_PROVIDERS = ['KAKAO', 'APPLE', 'EMAIL'] as const;
export type LinkableProvider = (typeof LINKABLE_PROVIDERS)[number];
/** 웹 OAuth 로 시작하는 제공자 */
export const WEB_LINK_PROVIDERS = ['KAKAO', 'APPLE'] as const;

/**
 * POST /me/auth-accounts (#198). 넷 중 하나:
 * `{ ticket }` 웹 OAuth 연결 티켓 | `{ provider: KAKAO, accessToken }` 앱 카카오 SDK |
 * `{ provider: APPLE, identityToken, authorizationCode, nonce }` 앱 Apple | `{ provider: EMAIL, email, code }` 이메일 코드
 */
export class LinkAuthAccountDto {
  @IsOptional()
  @IsString({ message: 'ticket 은 문자열이어야 해요' })
  @Matches(new RegExp(`^[A-Za-z0-9_-]{${HANDOFF_LENGTH}}$`), {
    message: 'ticket 형식이 올바르지 않아요',
  })
  ticket?: string;

  @IsOptional()
  @IsIn(LINKABLE_PROVIDERS, {
    message: 'provider 는 KAKAO, APPLE, EMAIL 중 하나여야 해요',
  })
  provider?: LinkableProvider;

  @ValidateIf((dto: LinkAuthAccountDto) => dto.provider === 'KAKAO')
  @IsString({ message: 'accessToken 은 문자열이어야 해요' })
  @Length(1, 512, { message: 'accessToken 은 1~512자여야 해요' })
  accessToken?: string;

  @ValidateIf((dto: LinkAuthAccountDto) => dto.provider === 'APPLE')
  @IsString({ message: 'identityToken 은 문자열이어야 해요' })
  @Length(1, 4096, { message: 'identityToken 은 1~4096자여야 해요' })
  identityToken?: string;

  @ValidateIf((dto: LinkAuthAccountDto) => dto.provider === 'APPLE')
  @IsString({ message: 'authorizationCode 는 문자열이어야 해요' })
  @Length(1, 512, { message: 'authorizationCode 는 1~512자여야 해요' })
  authorizationCode?: string;

  @ValidateIf((dto: LinkAuthAccountDto) => dto.provider === 'APPLE')
  @IsString({ message: 'nonce 는 문자열이어야 해요' })
  @Length(32, 128, { message: 'nonce 는 32~128자여야 해요' })
  nonce?: string;

  @ValidateIf((dto: LinkAuthAccountDto) => dto.provider === 'EMAIL')
  @EmailAddress()
  email?: string;

  @ValidateIf((dto: LinkAuthAccountDto) => dto.provider === 'EMAIL')
  @IsString({ message: '코드는 문자열이어야 해요' })
  @Matches(CODE_PATTERN, { message: '코드는 6자리 숫자여야 해요' })
  code?: string;
}

/** POST /me/auth-accounts/link-start (#198). 웹 OAuth 연결 시작 표식 */
export class LinkStartDto {
  @IsIn(WEB_LINK_PROVIDERS, {
    message: 'provider 는 KAKAO 또는 APPLE 이어야 해요',
  })
  provider!: (typeof WEB_LINK_PROVIDERS)[number];
}
