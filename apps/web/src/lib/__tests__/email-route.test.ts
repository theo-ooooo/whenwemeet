// (#245) 이메일 로그인 route handler (이메일-로그인.md 6-1, 10장 웹 단위)
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.fn();
vi.mock("@/lib/upstream", () => ({ upstream: (...a: unknown[]) => upstream(...a), isMock: () => false }));

const request = (await import("@/app/auth/email/request/route")).POST;
const code = (await import("@/app/auth/email/code/route")).POST;
const link = (await import("@/app/auth/email/link/route")).POST;
const signup = (await import("@/app/auth/email/signup/route")).POST;
const { opensInstalledApp } = await import("@/lib/well-known");

const ORIGIN = "https://whenwemeet.day";
const TOKEN = "A".repeat(43);
const okEnv = (data: unknown) => ({ status: 200, body: { status: 200, data, message: "OK" } });
const errEnv = (status: number, code: string, details?: unknown) => ({
  status,
  body: { status, data: null, message: "문구", error: details === undefined ? { code } : { code, details } },
});

function jsonReq(path: string, body: unknown, opts: { origin?: string | null; cookie?: string; ua?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  if (opts.origin !== null) headers.set("origin", opts.origin ?? ORIGIN);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.ua) headers.set("user-agent", opts.ua);
  return new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function formReq(form: Record<string, string>, origin: string | null = ORIGIN) {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("origin", origin);
  return new NextRequest(`${ORIGIN}/auth/email/link`, { method: "POST", headers, body: new URLSearchParams(form).toString() });
}

beforeEach(() => {
  vi.stubEnv("EMAIL_LOGIN_ENABLED", "1");
});
afterEach(() => {
  upstream.mockReset();
  vi.unstubAllEnvs();
});

describe("공통: Origin, 스위치", () => {
  it("Origin 이 다르거나 없으면 403, API 를 부르지 않는다", async () => {
    expect((await request(jsonReq("/auth/email/request", { email: "a@b.co" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await code(jsonReq("/auth/email/code", { email: "a@b.co", code: "123456" }, { origin: null }))).status).toBe(403);
    expect((await link(formReq({ token: TOKEN }, "https://evil.example"))).status).toBe(403);
    expect((await signup(jsonReq("/auth/email/signup", { nickname: "지우" }, { origin: "null" }))).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("스위치가 꺼져 있으면 503 EMAIL_NOT_CONFIGURED", async () => {
    vi.stubEnv("EMAIL_LOGIN_ENABLED", "");
    const res = await request(jsonReq("/auth/email/request", { email: "a@b.co" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("POST /auth/email/request", () => {
  it("내부 헤더용 IP 와 safeNext 한 next 로 API 를 부르고 봉투를 돌려준다", async () => {
    upstream.mockResolvedValue(okEnv({ cooldownSec: 60, expiresInSec: 900 }));
    const res = await request(jsonReq("/auth/email/request", { email: " a@b.co ", next: "//evil.com" }));
    expect(upstream).toHaveBeenCalledWith({
      method: "POST",
      path: "/auth/email/request",
      body: JSON.stringify({ email: "a@b.co", next: "/" }),
      token: null,
      internal: { clientIp: "203.0.113.9" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).data).toEqual({ cooldownSec: 60, expiresInSec: 900 });
  });
  it("429 details 객체를 [{ field, message }] 로 옮긴다", async () => {
    upstream.mockResolvedValue(errEnv(429, "EMAIL_RATE_LIMITED", { reason: "COOLDOWN", retryAfterSec: 42 }));
    const res = await request(jsonReq("/auth/email/request", { email: "a@b.co" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toEqual({
      code: "EMAIL_RATE_LIMITED",
      details: [
        { field: "reason", message: "COOLDOWN" },
        { field: "retryAfterSec", message: "42" },
      ],
    });
  });
  it("빈 이메일은 API 를 부르지 않고 400", async () => {
    expect((await request(jsonReq("/auth/email/request", { email: "  " }))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("POST /auth/email/code", () => {
  it("SESSION: wwm_session 설정, wwm_group 삭제, redirect = 착지 화면?next=safeNext(next). 토큰은 본문에 없다", async () => {
    upstream.mockResolvedValue(okEnv({ kind: "SESSION", token: "h.p.s", next: "/join/ABC123?auto=1" }));
    const res = await code(
      jsonReq("/auth/email/code", { email: "a@b.co", code: "123 456" }, { ua: "Mozilla/5.0 WhenwemeetApp/1.1.0 (ios) EmailLogin/1" }),
    );
    expect(JSON.parse(upstream.mock.calls[0][0].body)).toEqual({ email: "a@b.co", code: "123456", client: "app" });
    const body = await res.json();
    expect(body.data).toEqual({ redirect: "/auth/landing?next=%2Fjoin%2FABC123%3Fauto%3D1" });
    expect(JSON.stringify(body)).not.toContain("h.p.s");
    const session = res.cookies.get("wwm_session");
    expect(session?.value).toBe("h.p.s");
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("lax");
    expect(res.cookies.get("wwm_group")?.maxAge).toBe(0);
  });
  it("SIGNUP: wwm_signup(httpOnly, 30분) 설정 후 닉네임 화면", async () => {
    upstream.mockResolvedValue(okEnv({ kind: "SIGNUP", signupToken: "ticket", next: "/" }));
    const res = await code(jsonReq("/auth/email/code", { email: "new@b.co", code: "000000" }));
    expect(JSON.parse(upstream.mock.calls[0][0].body).client).toBe("web");
    expect((await res.json()).data).toEqual({ redirect: "/login/email/nickname" });
    const c = res.cookies.get("wwm_signup");
    expect(c?.value).toBe("ticket");
    expect(c?.httpOnly).toBe(true);
    expect(c?.maxAge).toBe(1800);
    expect(res.cookies.get("wwm_session")).toBeUndefined();
  });
  it("next 가 바깥 주소면 next 없는 착지 화면 (= /)", async () => {
    upstream.mockResolvedValue(okEnv({ kind: "SESSION", token: "h.p.s", next: "https://evil.com" }));
    expect((await (await code(jsonReq("/auth/email/code", { email: "a@b.co", code: "000000" }))).json()).data.redirect).toBe("/auth/landing");
  });
  it("틀린 코드는 attemptsLeft 를 그대로", async () => {
    upstream.mockResolvedValue(errEnv(400, "EMAIL_CODE_INVALID", { attemptsLeft: 4 }));
    const body = await (await code(jsonReq("/auth/email/code", { email: "a@b.co", code: "111111" }))).json();
    expect(body.error).toEqual({ code: "EMAIL_CODE_INVALID", details: [{ field: "attemptsLeft", message: "4" }] });
  });
  it("6자리가 아니면 API 를 부르지 않는다", async () => {
    expect((await code(jsonReq("/auth/email/code", { email: "a@b.co", code: "12345" }))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("POST /auth/email/link (303)", () => {
  it("SESSION 이면 착지 화면으로 303 + 세션 쿠키 (next 는 쿼리로, #307)", async () => {
    upstream.mockResolvedValue(okEnv({ kind: "SESSION", token: "h.p.s", next: "/g/2/calendar" }));
    const res = await link(formReq({ token: TOKEN }));
    expect(upstream.mock.calls[0][0].path).toBe("/auth/email/link");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/auth/landing?next=%2Fg%2F2%2Fcalendar`);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.cookies.get("wwm_session")?.value).toBe("h.p.s");
  });
  it("SIGNUP 이면 닉네임 화면으로", async () => {
    upstream.mockResolvedValue(okEnv({ kind: "SIGNUP", signupToken: "ticket", next: "/" }));
    const res = await link(formReq({ token: TOKEN }));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login/email/nickname`);
    expect(res.cookies.get("wwm_signup")?.value).toBe("ticket");
  });
  it("실패는 토큰 없이 ?error=<reason>", async () => {
    upstream.mockResolvedValue(errEnv(400, "EMAIL_LINK_INVALID", { reason: "USED" }));
    const res = await link(formReq({ token: TOKEN }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/auth/email?error=USED`);
    expect(res.headers.get("location")).not.toContain(TOKEN);
    upstream.mockResolvedValue(errEnv(502, "UPSTREAM_UNAVAILABLE"));
    expect((await link(formReq({ token: TOKEN }))).headers.get("location")).toBe(`${ORIGIN}/auth/email?error=UNAVAILABLE`);
  });
  it("토큰 모양이 틀리면 API 를 부르지 않고 INVALID", async () => {
    const res = await link(formReq({ token: "short" }));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/auth/email?error=INVALID`);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("POST /auth/email/signup", () => {
  it("쿠키의 가입 티켓으로 가입, 세션 설정, 티켓 쿠키 삭제", async () => {
    upstream.mockResolvedValue(okEnv({ token: "h.p.s", next: "/join/ABC123?auto=1" }));
    const res = await signup(jsonReq("/auth/email/signup", { nickname: " 지우 " }, { cookie: "wwm_signup=ticket" }));
    expect(JSON.parse(upstream.mock.calls[0][0].body)).toEqual({ signupToken: "ticket", nickname: "지우", client: "web" });
    expect((await res.json()).data).toEqual({ redirect: "/auth/landing?next=%2Fjoin%2FABC123%3Fauto%3D1" });
    expect(res.cookies.get("wwm_session")?.value).toBe("h.p.s");
    expect(res.cookies.get("wwm_signup")?.maxAge).toBe(0);
  });
  it("티켓 쿠키가 없으면 401 SIGNUP_TOKEN_INVALID", async () => {
    const res = await signup(jsonReq("/auth/email/signup", { nickname: "지우" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("SIGNUP_TOKEN_INVALID");
    expect(upstream).not.toHaveBeenCalled();
  });
  it("닉네임 1자는 400, API 401 은 쿠키를 지운다", async () => {
    expect((await signup(jsonReq("/auth/email/signup", { nickname: "지" }, { cookie: "wwm_signup=t" }))).status).toBe(400);
    upstream.mockResolvedValue(errEnv(401, "SIGNUP_TOKEN_INVALID"));
    const res = await signup(jsonReq("/auth/email/signup", { nickname: "지우" }, { cookie: "wwm_signup=t" }));
    expect(res.status).toBe(401);
    expect(res.cookies.get("wwm_signup")?.maxAge).toBe(0);
  });
});

// (#307) Android Gmail 인앱 브라우저(Custom Tab)는 폼 제출 뒤 리다이렉트와 제스처 이동이 앱 링크 경로에 닿으면 설치된 앱으로 넘긴다.
// 앱 웹뷰에는 세션이 없어 앱 로그인 화면에서 끝났다. 세션을 만든 응답의 이동 대상은 어떤 next 여도 앱 링크 경로가 아니어야 한다
describe("로그인 직후 이동은 앱 링크 경로로 가지 않는다 (#307)", () => {
  const NEXTS = ["/", "/g/12/calendar", "/g/12/calendar?date=2026-11-12", "/groups/new", "/join/ABC123?auto=1&by=3", "/me"];
  const pathOf = (loc: string) => {
    const u = new URL(loc, ORIGIN);
    return { path: u.pathname + u.search, next: u.searchParams.get("next") ?? "/" };
  };

  it.each(NEXTS)("link 303 (next=%s)", async (next) => {
    upstream.mockResolvedValue(okEnv({ kind: "SESSION", token: "h.p.s", next }));
    const res = await link(formReq({ token: TOKEN }));
    const { path, next: carried } = pathOf(res.headers.get("location") ?? "");
    expect(opensInstalledApp(path)).toBe(false);
    expect(path.startsWith("/auth/landing")).toBe(true);
    expect(carried).toBe(next);
  });
  it.each(NEXTS)("code redirect (next=%s)", async (next) => {
    upstream.mockResolvedValue(okEnv({ kind: "SESSION", token: "h.p.s", next }));
    const { redirect } = (await (await code(jsonReq("/auth/email/code", { email: "a@b.co", code: "000000" }))).json()).data;
    expect(opensInstalledApp(redirect)).toBe(false);
    expect(pathOf(redirect).next).toBe(next);
  });
  it.each(NEXTS)("signup redirect (next=%s)", async (next) => {
    upstream.mockResolvedValue(okEnv({ token: "h.p.s", next }));
    const res = await signup(jsonReq("/auth/email/signup", { nickname: "지우" }, { cookie: "wwm_signup=t" }));
    const { redirect } = (await res.json()).data;
    expect(opensInstalledApp(redirect)).toBe(false);
    expect(pathOf(redirect).next).toBe(next);
  });
});
