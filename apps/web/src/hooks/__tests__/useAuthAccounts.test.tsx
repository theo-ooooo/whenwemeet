// @vitest-environment happy-dom
// (#198) 앱 연결 훅: 셸이 돌려준 네이티브 로그인 결과를 provider 와 함께 POST /me/auth-accounts 본문에 싣는다 (앱.md 4.8)
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => ({ api, ApiError: class extends Error {} }));

const { useCheckAppLink, useLinkAppAccount } = await import("../useAuthAccounts");

describe("useLinkAppAccount, useCheckAppLink (#198)", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue({ account: { id: 1 }, absorbed: false });
  });

  it("카카오: { provider: KAKAO, accessToken }", async () => {
    const { result } = renderHook(() => useLinkAppAccount());
    await act(async () => {
      await result.current.mutate({ provider: "KAKAO", credentials: { accessToken: "at" } });
    });
    expect(api).toHaveBeenCalledWith("/me/auth-accounts", { method: "POST", body: { provider: "KAKAO", accessToken: "at" } });
  });

  it("Apple: { provider: APPLE, identityToken, authorizationCode, nonce }", async () => {
    const { result } = renderHook(() => useLinkAppAccount());
    const nonce = "n".repeat(64);
    await act(async () => {
      await result.current.mutate({ provider: "APPLE", credentials: { identityToken: "it", authorizationCode: "c", nonce } });
    });
    expect(api).toHaveBeenCalledWith("/me/auth-accounts", {
      method: "POST",
      body: { provider: "APPLE", identityToken: "it", authorizationCode: "c", nonce },
    });
  });

  it("확인: POST /me/auth-accounts/link-start { provider }", async () => {
    const { result } = renderHook(() => useCheckAppLink());
    await act(async () => {
      await result.current.mutate("APPLE");
    });
    expect(api).toHaveBeenCalledWith("/me/auth-accounts/link-start", { method: "POST", body: { provider: "APPLE" } });
  });
});
