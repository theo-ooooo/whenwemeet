import { IsString, Length, Matches } from 'class-validator';
import { CODE_CHALLENGE_LENGTH, HANDOFF_LENGTH } from '../pkce.js';

/** POST /auth/kakao/native (앱.md 3.1) */
export class KakaoNativeLoginDto {
  @IsString({ message: 'accessToken 은 문자열이어야 해요' })
  @Length(1, 512, { message: 'accessToken 은 1~512자여야 해요' })
  accessToken!: string;

  @IsString({ message: 'codeChallenge 는 문자열이어야 해요' })
  @Matches(new RegExp(`^[A-Za-z0-9_-]{${CODE_CHALLENGE_LENGTH}}$`), { message: 'codeChallenge 형식이 올바르지 않아요' })
  codeChallenge!: string;
}

/** POST /auth/handoff (앱.md 2.2). verifier 는 RFC 7636 의 문자 집합과 길이 */
export class HandoffExchangeDto {
  @IsString({ message: 'handoff 는 문자열이어야 해요' })
  @Matches(new RegExp(`^[A-Za-z0-9_-]{${HANDOFF_LENGTH}}$`), { message: 'handoff 형식이 올바르지 않아요' })
  handoff!: string;

  @IsString({ message: 'verifier 는 문자열이어야 해요' })
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/, { message: 'verifier 형식이 올바르지 않아요' })
  verifier!: string;
}
