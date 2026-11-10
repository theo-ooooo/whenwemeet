import { AuthApiError, requestHandoff } from "../api";

const H = "h".repeat(43);
const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("requestHandoff", () => {
  it("POST JSON 후 data.handoff 를 돌려준다", async () => {
    const f = jest.fn(async () => res(200, { status: 200, data: { handoff: H, expiresIn: 60 }, message: "OK" }));
    await expect(
      requestHandoff("https://api.whenwemeet.day/", "/v1/auth/kakao/native", { accessToken: "t", codeChallenge: "c" }, f),
    ).resolves.toBe(H);
    expect(f).toHaveBeenCalledWith("https://api.whenwemeet.day/v1/auth/kakao/native", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ accessToken: "t", codeChallenge: "c" }),
    });
  });

  it("오류 봉투의 code 와 message 를 그대로", async () => {
    const f = async () =>
      res(401, { status: 401, data: null, message: "다시 로그인해 주세요", error: { code: "SOCIAL_TOKEN_INVALID" } });
    await expect(requestHandoff("https://a", "/v1/auth/kakao/native", {}, f)).rejects.toMatchObject({
      code: "SOCIAL_TOKEN_INVALID",
      message: "다시 로그인해 주세요",
      status: 401,
    });
  });

  it("본문 없는 5xx, 네트워크 오류, 이상한 handoff", async () => {
    const noBody = async () => ({ ok: false, status: 502, json: async () => Promise.reject(new Error("x")) }) as unknown as Response;
    await expect(requestHandoff("https://a", "/v1/auth/apple/native", {}, noBody)).rejects.toMatchObject({ code: "HTTP_502" });
    const down = async () => Promise.reject(new TypeError("Network request failed"));
    await expect(requestHandoff("https://a", "/v1/auth/apple/native", {}, down)).rejects.toMatchObject({ code: "NETWORK" });
    const bad = async () => res(200, { data: { handoff: "x" } });
    await expect(requestHandoff("https://a", "/v1/auth/apple/native", {}, bad)).rejects.toBeInstanceOf(AuthApiError);
  });
});
