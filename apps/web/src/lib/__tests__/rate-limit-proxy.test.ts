// (#186) 프록시가 사용자 IP 를 API 로 넘기고 429 를 그대로 돌려주는지, 화면 문구, /auth/app 의 429
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toFailure } from "@/hooks/_error";
import { ApiError } from "../api";

const upstream = vi.fn();
vi.mock("@/lib/upstream", () => ({ upstream: (...a: unknown[]) => upstream(...a), isMock: () => false }));

const proxy = await import("@/app/api/[...path]/route");
const appLogin = (await import("@/app/auth/app/route")).GET;

const ORIGIN = "https://whenwemeet.day";
const limited = {
  status: 429,
  body: { status: 429, data: null, message: "잠시 후 다시 시도해 주세요", error: { code: "RATE_LIMITED", details: { retryAfterSec: 42 } } },
  retryAfter: "42",
};

function proxyReq(path: string, init: { method?: string; body?: string; session?: string | null } = {}) {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  if (init.session !== null) headers.set("cookie", `wwm_session=${init.session ?? "jwt.abc.def"}`);
  if (init.body) headers.set("content-type", "application/json");
  return new NextRequest(`${ORIGIN}/api/${path}`, { method: init.method ?? "GET", headers, body: init.body });
}
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

afterEach(() => upstream.mockReset());

describe("/api/[...path] 프록시 (#186)", () => {
  it("사용자 IP(X-Forwarded-For 첫 값)를 internal 로 넘긴다", async () => {
    upstream.mockResolvedValue({ status: 200, body: { status: 200, data: [], message: "OK" } });
    await proxy.GET(proxyReq("groups"), ctx("groups"));
    expect(upstream).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/groups", token: "jwt.abc.def", internal: { clientIp: "203.0.113.9" } }),
    );
  });

  it("비로그인 초대 미리보기도 IP 를 넘긴다", async () => {
    upstream.mockResolvedValue({ status: 404, body: {} });
    await proxy.GET(proxyReq("invites/ABCDEF", { session: null }), ctx("invites/ABCDEF"));
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({ token: null, internal: { clientIp: "203.0.113.9" } }));
  });

  it("429 는 봉투와 Retry-After 를 그대로 브라우저에", async () => {
    upstream.mockResolvedValue(limited);
    const res = await proxy.POST(proxyReq("groups/join", { method: "POST", body: '{"code":"123456"}' }), ctx("groups/join"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });
});

describe("화면 문구 (#186)", () => {
  it("RATE_LIMITED 는 어느 화면이든 '잠시 후 다시 시도해 주세요'", () => {
    expect(toFailure(new ApiError(429, "RATE_LIMITED", "다른 문구")).message).toBe("잠시 후 다시 시도해 주세요");
    expect(toFailure(new ApiError(429, "RATE_LIMITED", "")).message).toBe("잠시 후 다시 시도해 주세요");
    expect(toFailure(new ApiError(404, "INVITE_NOT_FOUND", "초대 코드를 찾을 수 없어요")).message).toBe("초대 코드를 찾을 수 없어요");
  });
});

describe("/auth/app handoff 교환 (#186)", () => {
  const H = "A".repeat(43);
  const V = "b".repeat(43);
  const appReq = () => new NextRequest(`${ORIGIN}/auth/app?h=${H}&v=${V}`, { headers: { "x-forwarded-for": "198.51.100.4" } });

  it("앱 사용자 IP 를 넘기고, 429 면 /login?error=RATE_LIMITED", async () => {
    upstream.mockResolvedValue(limited);
    const res = await appLogin(appReq());
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({ path: "/auth/handoff", internal: { clientIp: "198.51.100.4" } }));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("RATE_LIMITED");
  });
});
