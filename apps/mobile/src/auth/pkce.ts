// handoff verifier/challenge, 애플 nonce (docs/설계/앱.md 2.1, 3.3). 해시/난수 함수는 주입받는다 (테스트는 node:crypto)

/** 바이트 → base64url (패딩 없음) */
export function base64url(bytes: Uint8Array): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63];
  }
  return out;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type RandomBytes = (n: number) => Uint8Array;
export type Sha256 = (input: Uint8Array) => Promise<Uint8Array>;

const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;

/** 32바이트 난수 → base64url 43자. 로그인 시작마다 새로 만들고 메모리에만 둔다 */
export function createVerifier(randomBytes: RandomBytes): string {
  const v = base64url(randomBytes(32));
  if (!VERIFIER_RE.test(v)) throw new Error("verifier 생성 실패");
  return v;
}

/** codeChallenge = base64url(sha256(verifier)) — PKCE S256 */
export async function codeChallenge(verifier: string, sha256: Sha256): Promise<string> {
  if (!VERIFIER_RE.test(verifier)) throw new Error("verifier 형식 오류");
  return base64url(await sha256(new TextEncoder().encode(verifier)));
}

/** 애플 nonce: 원문(API 로)과 sha256 hex(Apple 요청으로) */
export async function createAppleNonce(randomBytes: RandomBytes, sha256: Sha256): Promise<{ raw: string; hashed: string }> {
  const raw = hex(randomBytes(32));
  const hashed = hex(await sha256(new TextEncoder().encode(raw)));
  return { raw, hashed };
}

/** 애플 fullName → 닉네임 초기값 (3.2: 성 + 이름, 공백 정리, 20자). 한글 이름은 붙여 쓴다 */
export function appleNickname(name: { familyName?: string | null; givenName?: string | null } | null | undefined): string | undefined {
  if (!name) return undefined;
  const family = (name.familyName ?? "").trim();
  const given = (name.givenName ?? "").trim();
  if (!family && !given) return undefined;
  const hangul = /^[가-힣]+$/;
  const joined = hangul.test(family) && hangul.test(given) ? `${family}${given}` : [family, given].filter(Boolean).join(" ");
  const nick = joined.replace(/\s+/g, " ").trim().slice(0, 20);
  return nick || undefined;
}
