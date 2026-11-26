// (#245) API_MOCK=1 의 이메일 로그인 (이메일-로그인.md 4-2, 4-3, 6-1 목 규칙). 실제 API 와 같은 봉투, 상태 코드, 오류 코드.
// - 맞는 코드는 000000 (심사 계정처럼 고정). 이메일이 new@ 로 시작하면(new.x@, new2@ 처럼 new 로 시작하는 로컬도) 처음 가입(SIGNUP), 아니면 기본 사용자(SESSION)
// - 링크 토큰: mock = 유효, mock-used = 사용됨, mock-expired = 만료, 그 밖 = 없음
// - 화면 확인용 오류: limit@ → HOURLY, ip@ → IP, off@ → EMAIL_NOT_CONFIGURED. 같은 이메일 60초 안 재요청은 COOLDOWN
// - 틀린 코드 5번이면 잠김(LOCKED), 메일이 없거나 끝났으면 EXPIRED. 가입 티켓은 30분 1회
import { errorBody, okBody } from "@/lib/envelope";
import { maskEmail, NICKNAME_MAX, nicknameOk, normalizeEmail } from "@/lib/email-login";
import type { Store } from "./fixtures";

type Result = { status: number; body: unknown };
type Challenge = {
  /** (#198) LINK 는 로그인 방법 연결 코드 (로그인에 못 쓴다) */
  purpose?: "LOGIN" | "LINK";
  email: string;
  createdAt: number;
  next: string;
  attempts: number;
  usedAt: number | null;
  invalidatedAt: number | null;
  signupToken: string | null;
  signupExpiresAt: number;
};

const g = globalThis as unknown as { __wwmMockEmail?: { challenges: Challenge[] } };
function state() {
  if (!g.__wwmMockEmail) g.__wwmMockEmail = { challenges: [] };
  return g.__wwmMockEmail;
}

/** 테스트용: 목 이메일 상태 비우기 */
export function resetMockEmail(): void {
  g.__wwmMockEmail = { challenges: [] };
}

export const MOCK_EMAIL_CODE = "000000";
const COOLDOWN_MS = 60_000;
const EXPIRES_MS = 15 * 60_000;
const SIGNUP_MS = 30 * 60_000;

const ok = (data: unknown): Result => ({ status: 200, body: okBody(data) });
const err = (status: number, code: string, message: string, details?: Record<string, unknown>): Result => {
  const body = errorBody(status, code, message) as { error: Record<string, unknown> };
  // 설계 4-3 의 details 객체 모양 그대로 (웹 route handler 가 배열로 옮긴다)
  if (details) body.error.details = details;
  return { status, body };
};

const alive = (c: Challenge, now: number) => c.usedAt === null && c.invalidatedAt === null && now - c.createdAt < EXPIRES_MS;

const EMAIL_SHAPE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

let seq = 0;
const newToken = () => `mock-signup-${Date.now().toString(36)}-${(seq += 1)}`;

/** 처음 가입자 계정 만들기 (개인 달력 포함). 목 세션 토큰 'mock.<id>.sig' */
function createUser(s: Store, nickname: string): number {
  s.seq += 1;
  const userId = s.seq;
  s.seq += 1;
  const groupId = s.seq;
  const at = new Date().toISOString();
  s.users.push({ id: userId, nickname, profileImageUrl: null, createdAt: at });
  s.groups.push({ id: groupId, type: "PERSONAL", name: "내 달력", inviteCode: null, createdAt: at });
  s.memberships.push({ userId, groupId, color: "#F26D6D", displayName: null, joinedAt: at, lastSeenAt: null });
  return userId;
}

/** 소비 성공 → 기존 계정 SESSION, 처음이면 SIGNUP */
function consume(c: Challenge, now: number): Result {
  c.usedAt = now;
  if (/^new[^@]*@/.test(c.email)) {
    c.signupToken = newToken();
    c.signupExpiresAt = now + SIGNUP_MS;
    return ok({ kind: "SIGNUP", signupToken: c.signupToken, next: c.next });
  }
  return ok({ kind: "SESSION", token: "mock.me.sig", next: c.next });
}

/** /auth/email/* 처리. 해당 경로가 아니면 null */
export function mockEmailLogin(s: Store, method: string, path: string, body: Record<string, unknown> | null): Result | null {
  if (method !== "POST" || !path.startsWith("/auth/email/")) return null;
  const name = path.slice("/auth/email/".length);
  const now = Date.now();
  const st = state();

  if (name === "request") {
    const email = normalizeEmail(typeof body?.email === "string" ? body.email : "");
    if (!EMAIL_SHAPE.test(email) || email.length > 191) {
      return err(400, "VALIDATION_FAILED", "이메일 주소를 확인해 주세요");
    }
    if (email.startsWith("off@")) return err(503, "EMAIL_NOT_CONFIGURED", "지금은 이메일로 로그인할 수 없어요");
    if (email.startsWith("limit@")) {
      return err(429, "EMAIL_RATE_LIMITED", "잠시 후 다시 보내 주세요", { reason: "HOURLY", retryAfterSec: 1500 });
    }
    if (email.startsWith("ip@")) return err(429, "EMAIL_RATE_LIMITED", "잠시 후 다시 보내 주세요", { reason: "IP", retryAfterSec: 600 });
    const last = st.challenges.filter((c) => c.email === email).at(-1);
    if (last && now - last.createdAt < COOLDOWN_MS) {
      return err(429, "EMAIL_RATE_LIMITED", "잠시 후 다시 보내 주세요", {
        reason: "COOLDOWN",
        retryAfterSec: Math.ceil((COOLDOWN_MS - (now - last.createdAt)) / 1000),
      });
    }
    const purpose = body?.purpose === "LINK" ? "LINK" : "LOGIN";
    for (const c of st.challenges) if (c.email === email && (c.purpose ?? "LOGIN") === purpose && alive(c, now)) c.invalidatedAt = now;
    const next = typeof body?.next === "string" && body.next.startsWith("/") ? body.next : "/";
    st.challenges.push({ purpose, email, createdAt: now, next, attempts: 0, usedAt: null, invalidatedAt: null, signupToken: null, signupExpiresAt: 0 });
    console.info(
      purpose === "LINK" ? `[mock email] ${email} 연결 코드 ${MOCK_EMAIL_CODE}` : `[mock email] ${email} 링크 /auth/email?token=mock 코드 ${MOCK_EMAIL_CODE}`,
    );
    return ok({ cooldownSec: 60, expiresInSec: 900 });
  }

  if (name === "link/inspect" || name === "link") {
    const token = typeof body?.token === "string" ? body.token : "";
    const latest = st.challenges.at(-1);
    const masked = latest ? maskEmail(latest.email) : "ji***@example.com";
    let stateName: "VALID" | "USED" | "EXPIRED" | "INVALID";
    if (token === "mock") stateName = latest && !alive(latest, now) ? (latest.usedAt ? "USED" : "EXPIRED") : "VALID";
    else if (token === "mock-used") stateName = "USED";
    else if (token === "mock-expired") stateName = "EXPIRED";
    else stateName = "INVALID";

    if (name === "link/inspect") return ok({ state: stateName, emailMasked: stateName === "INVALID" ? null : masked });
    if (stateName !== "VALID") return err(400, "EMAIL_LINK_INVALID", "로그인 링크를 쓸 수 없어요", { reason: stateName });
    // 요청 없이 mock 링크를 바로 연 경우는 기본 사용자 메일로 본다
    const c = latest ?? {
      email: "jiwoo@example.com",
      createdAt: now,
      next: "/",
      attempts: 0,
      usedAt: null,
      invalidatedAt: null,
      signupToken: null,
      signupExpiresAt: 0,
    };
    if (!latest) st.challenges.push(c);
    return consume(c, now);
  }

  if (name === "code") {
    const email = normalizeEmail(typeof body?.email === "string" ? body.email : "");
    const code = typeof body?.code === "string" ? body.code : "";
    if (!/^\d{6}$/.test(code)) return err(400, "VALIDATION_FAILED", "코드는 숫자 6자리예요");
    const c = st.challenges.filter((x) => x.email === email && (x.purpose ?? "LOGIN") === "LOGIN" && alive(x, now)).at(-1);
    if (!c) return err(400, "EMAIL_CODE_EXPIRED", "코드가 만료됐어요. 메일을 다시 받아 주세요");
    if (code !== MOCK_EMAIL_CODE) {
      c.attempts += 1;
      if (c.attempts >= 5) {
        c.invalidatedAt = now;
        return err(400, "EMAIL_CODE_LOCKED", "코드를 5번 틀렸어요. 메일을 다시 받아 주세요");
      }
      return err(400, "EMAIL_CODE_INVALID", "코드가 맞지 않아요", { attemptsLeft: 5 - c.attempts });
    }
    return consume(c, now);
  }

  if (name === "signup") {
    const token = typeof body?.signupToken === "string" ? body.signupToken : "";
    const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
    if (!nicknameOk(nickname)) return err(400, "VALIDATION_FAILED", `닉네임은 2~${NICKNAME_MAX}자여야 해요`);
    const c = st.challenges.find((x) => x.signupToken === token && x.signupExpiresAt > now);
    if (!token || !c) return err(401, "SIGNUP_TOKEN_INVALID", "가입 시간이 지났어요. 다시 시작해 주세요");
    c.signupToken = null;
    const userId = createUser(s, nickname);
    return ok({ token: `mock.${userId}.sig`, next: c.next });
  }

  return err(404, "NOT_FOUND", "요청한 주소가 없어요");
}

/**
 * (#198) 로그인 방법 연결 코드 확인 (POST /me/auth-accounts { provider: EMAIL }). 맞으면 null(성공), 아니면 오류 응답.
 * 규칙은 로그인 코드와 같다 (000000, 5번 틀리면 잠김)
 */
export function consumeMockLinkCode(rawEmail: string, code: string): Result | null {
  const email = normalizeEmail(rawEmail);
  const now = Date.now();
  const c = state()
    .challenges.filter((x) => x.email === email && x.purpose === "LINK" && alive(x, now))
    .at(-1);
  if (!c) return err(400, "EMAIL_CODE_EXPIRED", "코드가 만료됐어요. 메일을 다시 받아 주세요");
  if (code !== MOCK_EMAIL_CODE) {
    c.attempts += 1;
    if (c.attempts >= 5) {
      c.invalidatedAt = now;
      return err(400, "EMAIL_CODE_LOCKED", "코드를 5번 틀렸어요. 메일을 다시 받아 주세요");
    }
    return err(400, "EMAIL_CODE_INVALID", "코드가 맞지 않아요", { attemptsLeft: 5 - c.attempts });
  }
  c.usedAt = now;
  return null;
}
