// (#186) 웹 → API 호출이 모든 요청에 내부 키와 사용자 IP 를 싣고, 429 의 Retry-After 를 돌려주는지
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internalHeaders, upstream } from "../upstream";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.example");
  vi.stubEnv("API_MOCK", "");
  vi.stubEnv("INTERNAL_API_KEY", "web-key");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sentHeaders = () => fetchMock.mock.calls[0][1]?.headers as Record<string, string>;

describe("upstream 내부 헤더 (#186)", () => {
  it("사용자 IP 가 있으면 X-Client-IP 와 X-Internal-Key 를 싣는다", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 200, data: [], message: "OK" }));
    await upstream({ method: "GET", path: "/groups", token: "t", internal: { clientIp: "203.0.113.9" } });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example/v1/groups");
    expect(sentHeaders()).toMatchObject({ Authorization: "Bearer t", "X-Client-IP": "203.0.113.9", "X-Internal-Key": "web-key" });
  });

  it("사용자 IP 가 없어도(웹 서버 자신의 호출) 내부 키는 싣는다", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 200, data: { ok: true }, message: "OK" }));
    await upstream({ method: "GET", path: "/health", token: null });
    expect(sentHeaders()["X-Internal-Key"]).toBe("web-key");
    expect(sentHeaders()).not.toHaveProperty("X-Client-IP");
  });

  it("키가 비어 있으면 키 헤더를 빼고 보낸다 (개발)", async () => {
    vi.stubEnv("INTERNAL_API_KEY", "");
    fetchMock.mockResolvedValue(Response.json({ status: 200, data: null, message: "OK" }));
    await upstream({ method: "GET", path: "/me", token: "t", internal: { clientIp: "1.2.3.4" } });
    expect(sentHeaders()).not.toHaveProperty("X-Internal-Key");
    expect(sentHeaders()["X-Client-IP"]).toBe("1.2.3.4");
  });

  it("429 의 Retry-After 를 결과에 싣는다. 없으면 키도 없다", async () => {
    const body = { status: 429, data: null, message: "잠시 후 다시 시도해 주세요", error: { code: "RATE_LIMITED", details: { retryAfterSec: 30 } } };
    fetchMock.mockResolvedValueOnce(Response.json(body, { status: 429, headers: { "Retry-After": "30" } }));
    expect(await upstream({ method: "POST", path: "/groups/join", token: "t" })).toEqual({ status: 429, body, retryAfter: "30" });
    fetchMock.mockResolvedValueOnce(Response.json({ status: 200, data: 1, message: "OK" }));
    expect(await upstream({ method: "GET", path: "/x", token: "t" })).toEqual({ status: 200, body: { status: 200, data: 1, message: "OK" } });
  });

  it("internalHeaders(null) 은 키만", () => {
    expect(internalHeaders(null, "k")).toEqual({ "X-Internal-Key": "k" });
    expect(internalHeaders(null, "")).toEqual({});
  });
});
