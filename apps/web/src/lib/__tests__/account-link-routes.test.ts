import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const upstream = vi.fn();
let mock = false;
vi.mock("@/lib/upstream", () => ({
  upstream: (...a: unknown[]) => upstream(...a),
  isMock: () => mock,
  apiUrl: () => "https://api.whenwemeet.day",
}));

const { GET: landing } = await import("@/app/(team)/me/link/route");
const { POST: start } = await import("@/app/(team)/me/link/start/route");

const ORIGIN = "https://whenwemeet.day";

function get(query: string, session: string | null = "jwt.a.b") {
  const headers = new Headers();
  if (session) headers.set("cookie", `wwm_session=${session}`);
  return new NextRequest(`${ORIGIN}/me/link?${query}`, { headers });
}

function post(form: Record<string, string>, opts: { origin?: string | null; session?: string | null } = {}) {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.set("origin", origin);
  const session = opts.session === undefined ? "jwt.a.b" : opts.session;
  if (session) headers.set("cookie", `wwm_session=${session}`);
  return new NextRequest(`${ORIGIN}/me/link/start`, { method: "POST", headers, body: new URLSearchParams(form).toString() });
}

const ok = (data: unknown) => ({ status: 200, body: { status: 200, data, message: "OK" } });
const fail = (status: number, code: string) => ({ status, body: { status, data: null, message: "x", error: { code } } });

describe("(#198) /me/link 착지", () => {
  afterEach(() => {
    upstream.mockReset();
    mock = false;
  });

  it("세션으로 티켓을 소비하고 결과를 next 에 싣는다. 주소가 남지 않게 no-referrer", async () => {
    upstream.mockResolvedValue(ok({ account: { provider: "KAKAO" }, absorbed: true }));
    const res = await landing(get("ticket=abc_DEF-1&next=%2Fme%2Faccounts%3Fprovider%3DKAKAO"));
    expect(upstream).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/me/auth-accounts", body: JSON.stringify({ ticket: "abc_DEF-1" }), token: "jwt.a.b" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/me/accounts?provider=KAKAO&linked=KAKAO&absorbed=1`);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("API 오류, 콜백 오류, 깨진 티켓은 link_error 로. 오픈 리다이렉트 없음", async () => {
    upstream.mockResolvedValue(fail(409, "AUTH_ACCOUNT_IN_USE"));
    expect((await landing(get("ticket=t&next=https://evil.example"))).headers.get("location")).toBe(`${ORIGIN}/me/accounts?link_error=AUTH_ACCOUNT_IN_USE`);
    expect((await landing(get("error=APPLE_CANCELLED&next=/me/accounts"))).headers.get("location")).toBe(`${ORIGIN}/me/accounts?link_error=APPLE_CANCELLED`);
    expect((await landing(get("error=<script>"))).headers.get("location")).toBe(`${ORIGIN}/me/accounts?link_error=INTERNAL`);
    expect((await landing(get("ticket=a%2Fb"))).headers.get("location")).toBe(`${ORIGIN}/me/accounts?link_error=LINK_TICKET_INVALID`);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("세션이 없거나 만료(401)면 만료 처리로", async () => {
    expect((await landing(get("ticket=t", null))).headers.get("location")).toBe(`${ORIGIN}/auth/expired?next=%2Fme%2Faccounts`);
    upstream.mockResolvedValue(fail(401, "UNAUTHORIZED"));
    expect((await landing(get("ticket=t"))).headers.get("location")).toBe(`${ORIGIN}/auth/expired?next=%2Fme%2Faccounts`);
  });
});

describe("(#198) /me/link/start", () => {
  afterEach(() => {
    upstream.mockReset();
    mock = false;
  });

  it("같은 출처 form POST 만. 표식을 받아 API /v1/auth/<제공자>?mode=link 로", async () => {
    upstream.mockResolvedValue(ok({ intent: "INTENT.jwt.x", expiresIn: 600 }));
    const res = await start(post({ provider: "KAKAO", next: "/me/accounts" }));
    expect(upstream).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/me/auth-accounts/link-start", body: JSON.stringify({ provider: "KAKAO" }), token: "jwt.a.b" }),
    );
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://api.whenwemeet.day/v1/auth/kakao");
    expect(Object.fromEntries(location.searchParams)).toEqual({ mode: "link", intent: "INTENT.jwt.x", next: "/me/accounts?provider=KAKAO" });

    upstream.mockResolvedValue(ok({ intent: "I2", expiresIn: 600 }));
    const apple = new URL((await start(post({ provider: "APPLE" }))).headers.get("location")!);
    expect(apple.pathname).toBe("/v1/auth/apple");
  });

  it("다른 출처, Origin 없음은 403. 제공자 이상은 API 를 부르지 않는다", async () => {
    expect((await start(post({ provider: "KAKAO" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await start(post({ provider: "KAKAO" }, { origin: null }))).status).toBe(403);
    expect((await start(post({ provider: "EMAIL" }))).headers.get("location")).toBe(`${ORIGIN}/me/accounts?link_error=VALIDATION_FAILED`);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("최근 로그인이 아니면 REAUTH_REQUIRED 를 싣고 로그인 방법 화면으로", async () => {
    upstream.mockResolvedValue(fail(409, "REAUTH_REQUIRED"));
    expect((await start(post({ provider: "KAKAO" }))).headers.get("location")).toBe(`${ORIGIN}/me/accounts?link_error=REAUTH_REQUIRED&provider=KAKAO`);
  });

  it("목 모드는 제공자 없이 /me/link?ticket=mock-<제공자>", async () => {
    mock = true;
    upstream.mockResolvedValue(ok({ intent: "mock", expiresIn: 600 }));
    const location = new URL((await start(post({ provider: "APPLE" }))).headers.get("location")!);
    expect(location.pathname).toBe("/me/link");
    expect(location.searchParams.get("ticket")).toBe("mock-APPLE");
  });
});
