import {
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose';

/** 테스트용 애플 설정 값 (가짜). 키는 테스트마다 새로 만든다 */
export const APPLE_TEST_ENV = {
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_KEY_ID: 'KEY1234567',
  APPLE_BUNDLE_ID: 'day.whenwemeet.app',
  APPLE_SERVICE_ID: 'day.whenwemeet.web',
  APPLE_REDIRECT_URI: 'https://api.example.test/v1/auth/apple/callback',
} as const;

export const APPLE_TEST_KID = 'apple-test-kid';

/** Apple 을 흉내 내는 키 묶음. RSA 로 id_token 을 서명하고, ES256 .p8 은 client_secret 서명용 */
export interface AppleTestKeys {
  /** createRemoteJWKSet 대신 주입할 키 집합 */
  jwks: JWTVerifyGetKey;
  /** Apple 이 아닌 키 (서명 위조 테스트) */
  foreignKey: CryptoKey;
  signingKey: CryptoKey;
  /** APPLE_PRIVATE_KEY 에 넣을 PKCS8 PEM */
  p8: string;
  /** client_secret 검증용 공개키 */
  p8PublicKey: CryptoKey;
}

export async function createAppleTestKeys(): Promise<AppleTestKeys> {
  const rsa = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const ec = await generateKeyPair('ES256', { extractable: true });
  const jwk = {
    ...(await exportJWK(rsa.publicKey)),
    kid: APPLE_TEST_KID,
    alg: 'RS256',
    use: 'sig',
  };
  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    foreignKey: foreign.privateKey,
    signingKey: rsa.privateKey,
    p8: await exportPKCS8(ec.privateKey),
    p8PublicKey: ec.publicKey,
  };
}

export interface AppleTokenOptions {
  sub?: string;
  aud?: string;
  iss?: string;
  nonce?: string | null;
  nonceSupported?: boolean;
  /** 만료 시각(초). 기본 지금 + 10분 */
  exp?: number;
  key?: CryptoKey;
  alg?: string;
  kid?: string;
  email?: string;
}

/** Apple identity token 모양의 JWT */
export async function signAppleToken(
  keys: AppleTestKeys,
  options: AppleTokenOptions = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {};
  if (options.nonce !== null) claims.nonce = options.nonce ?? 'nonce';
  if (options.nonceSupported !== undefined)
    claims.nonce_supported = options.nonceSupported;
  if (options.email) claims.email = options.email;
  return new SignJWT(claims)
    .setProtectedHeader({
      alg: options.alg ?? 'RS256',
      kid: options.kid ?? APPLE_TEST_KID,
    })
    .setIssuer(options.iss ?? 'https://appleid.apple.com')
    .setAudience(options.aud ?? APPLE_TEST_ENV.APPLE_BUNDLE_ID)
    .setSubject(options.sub ?? '001234.apple-sub.0001')
    .setIssuedAt(now)
    .setExpirationTime(options.exp ?? now + 600)
    .sign(options.key ?? keys.signingKey);
}
