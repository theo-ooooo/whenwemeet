// (#245) 목 이메일 로그인 계약 (이메일-로그인.md 4-2, 4-3, 6-1 목 규칙)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockHandle } from "../handler";
import { MOCK_EMAIL_CODE, resetMockEmail } from "../email-login";

type Env = { status: number; body: { data: Record<string, unknown> | null; error?: { code: string; details?: Record<string, unknown> } } };
const post = (path: string, body: Record<string, unknown>) => mockHandle({ method: "POST", path, query: new URLSearchParams(), body, userId: null }) as Env;

beforeEach(() => {
  resetMockEmail();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T03:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("목 /auth/email/request", () => {
  it("200 { cooldownSec: 60, expiresInSec: 900 }, 60초 안 재요청은 COOLDOWN", () => {
    expect(post("/auth/email/request", { email: "Jiwoo@Example.com", next: "/" })).toMatchObject({
      status: 200,
      body: { data: { cooldownSec: 60, expiresInSec: 900 } },
    });
    vi.advanceTimersByTime(18_000);
    const r = post("/auth/email/request", { email: "jiwoo@example.com" });
    expect(r.status).toBe(429);
    expect(r.body.error).toEqual({ code: "EMAIL_RATE_LIMITED", details: { reason: "COOLDOWN", retryAfterSec: 42 } });
    vi.advanceTimersByTime(42_000);
    expect(post("/auth/email/request", { email: "jiwoo@example.com" }).status).toBe(200);
  });
  it("모양이 틀리면 400, 화면 확인용 HOURLY, IP, 꺼짐", () => {
    expect(post("/auth/email/request", { email: "nope" }).body.error?.code).toBe("VALIDATION_FAILED");
    expect(post("/auth/email/request", { email: "limit@x.com" }).body.error?.details).toEqual({ reason: "HOURLY", retryAfterSec: 1500 });
    expect(post("/auth/email/request", { email: "ip@x.com" }).body.error?.details?.reason).toBe("IP");
    expect(post("/auth/email/request", { email: "off@x.com" }).status).toBe(503);
  });
});

describe("목 /auth/email/code", () => {
  it("기존 이메일 + 000000 → SESSION, 한 번 쓰면 EXPIRED", () => {
    post("/auth/email/request", { email: "jiwoo@example.com", next: "/g/2/calendar" });
    const r = post("/auth/email/code", { email: "jiwoo@example.com", code: MOCK_EMAIL_CODE });
    expect(r.body.data).toEqual({ kind: "SESSION", token: "mock.me.sig", next: "/g/2/calendar" });
    expect(post("/auth/email/code", { email: "jiwoo@example.com", code: MOCK_EMAIL_CODE }).body.error?.code).toBe("EMAIL_CODE_EXPIRED");
  });
  it("틀리면 attemptsLeft 4..1, 5번째 LOCKED 뒤로는 EXPIRED", () => {
    post("/auth/email/request", { email: "a@b.co" });
    for (const left of [4, 3, 2, 1]) {
      expect(post("/auth/email/code", { email: "a@b.co", code: "111111" }).body.error).toEqual({
        code: "EMAIL_CODE_INVALID",
        details: { attemptsLeft: left },
      });
    }
    expect(post("/auth/email/code", { email: "a@b.co", code: "111111" }).body.error?.code).toBe("EMAIL_CODE_LOCKED");
    expect(post("/auth/email/code", { email: "a@b.co", code: MOCK_EMAIL_CODE }).body.error?.code).toBe("EMAIL_CODE_EXPIRED");
  });
  it("새로 받으면 이전 메일은 끝, 15분이 지나면 EXPIRED", () => {
    post("/auth/email/request", { email: "a@b.co" });
    vi.advanceTimersByTime(15 * 60_000);
    expect(post("/auth/email/code", { email: "a@b.co", code: MOCK_EMAIL_CODE }).body.error?.code).toBe("EMAIL_CODE_EXPIRED");
  });
  it("6자리 숫자가 아니면 VALIDATION_FAILED", () => {
    expect(post("/auth/email/code", { email: "a@b.co", code: "12a456" }).body.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("목 처음 가입 (new@)", () => {
  it("code → SIGNUP → signup 은 새 사용자 세션 + next, 티켓은 1회", () => {
    post("/auth/email/request", { email: "new@example.com", next: "/join/ABC123?auto=1" });
    const r = post("/auth/email/code", { email: "new@example.com", code: MOCK_EMAIL_CODE });
    expect(r.body.data?.kind).toBe("SIGNUP");
    const signupToken = r.body.data?.signupToken as string;
    expect(post("/auth/email/signup", { signupToken, nickname: "지" }).body.error?.code).toBe("VALIDATION_FAILED");
    const s = post("/auth/email/signup", { signupToken, nickname: "새친구" });
    expect(s.body.data?.next).toBe("/join/ABC123?auto=1");
    const token = s.body.data?.token as string;
    expect(token).toMatch(/^mock\.\d+\.sig$/);
    const me = mockHandle({ method: "GET", path: "/me", query: new URLSearchParams(), body: null, userId: Number(token.split(".")[1]) }) as Env;
    expect(me.body.data?.nickname).toBe("새친구");
    expect(post("/auth/email/signup", { signupToken, nickname: "또" + "친구" }).status).toBe(401);
  });
});

describe("목 링크", () => {
  it("inspect 는 소비하지 않고, link 는 1회", () => {
    post("/auth/email/request", { email: "kim@gmail.com" });
    expect(post("/auth/email/link/inspect", { token: "mock" }).body.data).toEqual({ state: "VALID", emailMasked: "ki***@gmail.com" });
    expect(post("/auth/email/link/inspect", { token: "mock" }).body.data?.state).toBe("VALID");
    expect(post("/auth/email/link", { token: "mock", client: "web" }).body.data?.kind).toBe("SESSION");
    expect(post("/auth/email/link/inspect", { token: "mock" }).body.data?.state).toBe("USED");
    expect(post("/auth/email/link", { token: "mock" }).body.error).toEqual({ code: "EMAIL_LINK_INVALID", details: { reason: "USED" } });
    // 링크를 쓰면 같은 메일의 코드도 끝
    expect(post("/auth/email/code", { email: "kim@gmail.com", code: MOCK_EMAIL_CODE }).body.error?.code).toBe("EMAIL_CODE_EXPIRED");
  });
  it("mock-used, mock-expired, 그 밖", () => {
    expect(post("/auth/email/link/inspect", { token: "mock-used" }).body.data?.state).toBe("USED");
    expect(post("/auth/email/link/inspect", { token: "mock-expired" }).body.data?.state).toBe("EXPIRED");
    expect(post("/auth/email/link/inspect", { token: "x" }).body.data).toEqual({ state: "INVALID", emailMasked: null });
  });
});
