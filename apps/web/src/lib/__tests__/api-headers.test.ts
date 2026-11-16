// (#450) api() 의 추가 헤더(X-Client-Source)와 프록시가 넘기는 허용 값
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { internalHeaders, upstream } from "../upstream";

afterEach(() => vi.unstubAllGlobals());

describe("api headers (#450)", () => {
  it("JSON 본문과 함께 X-Client-Source 를 싣는다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 201, data: { id: 1 }, message: "OK" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/groups/2/events", { method: "POST", body: { title: "a" }, headers: { "X-Client-Source": "assistant" } });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Client-Source": "assistant" });
  });

  it("헤더를 안 주면 예전과 같다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 200, data: [], message: "OK" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/groups");
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toBeUndefined();
    // 서버 전용 헤더 함수는 그대로 (출처 헤더는 upstream 이 따로 싣는다)
    expect(internalHeaders(null, "")).toEqual({});
  });
});

describe("upstream clientSource (#450)", () => {
  it("허용 값을 X-Client-Source 로 API 에 넘긴다", async () => {
    vi.stubEnv("API_URL", "http://api.test");
    vi.stubEnv("API_MOCK", "");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await upstream({ method: "POST", path: "/groups/2/events", body: "{}", token: "t", clientSource: "assistant-edit" });
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["X-Client-Source"]).toBe("assistant-edit");
    await upstream({ method: "POST", path: "/groups/2/events", body: "{}", token: "t" });
    expect(((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["X-Client-Source"]).toBeUndefined();
    vi.unstubAllEnvs();
  });
});
