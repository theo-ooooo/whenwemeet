// (#532) 웹 → API 호출이 브라우저 User-Agent 를 X-Client-UA 로 싣는지 (내부 키와 같이만, D-288)
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientUaHeaders, upstream } from "../upstream";

const IOS_UA = "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 WhenwemeetApp/1.3.0 (ios)";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.example");
  vi.stubEnv("API_MOCK", "");
  vi.stubEnv("INTERNAL_API_KEY", "web-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(Response.json({ status: 200, data: null, message: "OK" }));
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sentHeaders = (i = 0) => fetchMock.mock.calls[i][1]?.headers as Record<string, string>;

describe("clientUaHeaders (#532)", () => {
  it("키가 있을 때만, 앞뒤 공백을 빼고 512자까지", () => {
    expect(clientUaHeaders(IOS_UA, "k")).toEqual({ "X-Client-UA": IOS_UA });
    expect(clientUaHeaders(` ${"a".repeat(600)} `, "k")["X-Client-UA"]).toHaveLength(512);
    expect(clientUaHeaders(IOS_UA, "")).toEqual({});
    expect(clientUaHeaders(null, "k")).toEqual({});
    expect(clientUaHeaders("  ", "k")).toEqual({});
  });
});

describe("upstream userAgent (#532)", () => {
  it("UA 를 내부 키와 같이 싣는다. 없으면 싣지 않는다", async () => {
    await upstream({ method: "GET", path: "/me", token: "t", internal: { clientIp: "1.2.3.4" }, userAgent: IOS_UA });
    expect(sentHeaders()).toMatchObject({ "X-Internal-Key": "web-key", "X-Client-UA": IOS_UA });
    await upstream({ method: "GET", path: "/me", token: "t" });
    expect(sentHeaders(1)).not.toHaveProperty("X-Client-UA");
  });

  it("키가 비어 있으면(개발) UA 도 싣지 않는다", async () => {
    vi.stubEnv("INTERNAL_API_KEY", "");
    await upstream({ method: "GET", path: "/me", token: "t", userAgent: IOS_UA });
    expect(sentHeaders()).not.toHaveProperty("X-Client-UA");
  });
});

describe("/api/[...path] 프록시 (#532)", () => {
  it("브라우저 User-Agent 를 userAgent 로 넘긴다", async () => {
    const upstreamSpy = vi.fn().mockResolvedValue({ status: 200, body: { status: 200, data: [], message: "OK" } });
    vi.doMock("@/lib/upstream", () => ({ upstream: upstreamSpy, isMock: () => false }));
    const proxy = await import("@/app/api/[...path]/route");
    const req = new NextRequest("https://whenwemeet.day/api/groups", { headers: { cookie: "wwm_session=jwt.abc.def", "user-agent": IOS_UA } });
    await proxy.GET(req, { params: Promise.resolve({ path: ["groups"] }) });
    expect(upstreamSpy).toHaveBeenCalledWith(expect.objectContaining({ token: "jwt.abc.def", userAgent: IOS_UA }));
    vi.doUnmock("@/lib/upstream");
  });
});
