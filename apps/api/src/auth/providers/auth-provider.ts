import type { AuthProvider } from '../../generated/prisma/enums.js';

export type { AuthProvider };

/** 제공자 원본 프로필. AuthAccount.rawProfile 에 그대로 저장한다 (JSON 직렬화 가능한 값만) */
export type RawProfile = {
  [key: string]: string | number | boolean | null | RawProfile | RawProfile[];
};

/** 제공자가 인가 코드로 돌려주는 공통 프로필 (결정기록 D-34) */
export interface ProviderProfile {
  /** 제공자 쪽 사용자 식별자. 숫자 회원번호도 문자열로 */
  providerUserId: string;
  /** 가입 시 User.nickname 초기값. 이후 로그인에서는 쓰지 않는다 (D-36) */
  nickname: string;
  /** 소셜 프로필 사진 원본 주소. 가입 시 R2 로 복사한다 (D-37). 이후 로그인에서는 쓰지 않는다 */
  profileImageUrl: string | null;
  email?: string | null;
  raw: RawProfile;
  /** 탈퇴 시 제공자 토큰 폐기에 쓸 값 (애플만, 앱.md 3.2). 있으면 AuthAccount 에 저장한다 */
  credentials?: ProviderCredentials;
}

/** 제공자 토큰 폐기용 값 (D-51) */
export interface ProviderCredentials {
  /** 토큰을 발급받은 client_id (애플: 번들 ID 또는 Service ID) */
  providerClientId: string;
  refreshToken: string;
}

/** 탈퇴 시 unlink 에 넘기는 연결 계정 (앱.md 3.5). 카카오는 providerUserId 만 쓴다 */
export interface LinkedAccount {
  providerUserId: string;
  providerClientId: string | null;
  refreshToken: string | null;
}

/**
 * 소셜 로그인 제공자 하나. `auth/providers/<provider>.provider.ts` 가 구현한다.
 * 로그인 방식(인가 코드, 네이티브 토큰)은 제공자마다 달라 각 구현의 메서드로 두고, 공통은 탈퇴 시 unlink 만
 */
export interface AuthProviderClient {
  readonly provider: AuthProvider;
  /** 회원 탈퇴 시 제공자 쪽 연결 끊기(카카오 unlink, 애플 토큰 폐기). 이미 끊긴 경우는 성공으로 본다 */
  unlink(account: LinkedAccount): Promise<void>;
}
