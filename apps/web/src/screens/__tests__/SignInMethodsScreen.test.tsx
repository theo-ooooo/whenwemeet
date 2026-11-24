// @vitest-environment happy-dom
// (#198) 로그인 방법: 앱 셸(AccountLink/1) 안의 카카오, Apple 연결은 form POST 대신 셸 브리지 linkAccount →
// 세션으로 POST /me/auth-accounts (앱.md 4.8, D-282). 웹은 지금처럼 form POST
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLinkCredentials, AppLinkOutcome } from "@/lib/account-link";
import type { AuthAccount } from "@/lib/types";

type Outcome<T> = { ok: true; data: T; error: null } | { ok: false; data: null; error: { code: string; message: string; status: number } };

const show = vi.fn();
const refetch = vi.fn();
const check = vi.fn<(p: string) => Promise<Outcome<{ intent: string }>>>();
const link = vi.fn<(input: AppLinkCredentials) => Promise<Outcome<{ absorbed: boolean }>>>();
const requestAppLink = vi.fn<(p: string) => Promise<AppLinkOutcome>>();
const postToApp = vi.fn(() => true);
let accounts: AuthAccount[];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/me/accounts",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/lib/app-bridge", async (orig) => ({ ...(await orig<typeof import("@/lib/app-bridge")>()), postToApp }));
vi.mock("@/lib/account-link", async (orig) => ({ ...(await orig<typeof import("@/lib/account-link")>()), requestAppLink }));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useAuthAccounts: () => ({ data: accounts, error: null, isLoading: false, refetch }),
  useCheckAppLink: () => ({ mutate: check, isPending: false, error: null }),
  useLinkAppAccount: () => ({ mutate: link, isPending: false, error: null }),
  useLinkEmail: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRequestLinkEmail: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUnlinkAccount: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const { SignInMethodsScreen } = await import("../SignInMethodsScreen");

const KAKAO_ROW: AuthAccount = { id: 1, provider: "KAKAO", label: "카카오 계정", createdAt: "2026-11-01T00:00:00.000Z" } as AuthAccount;
const ok = <T,>(data: T): Outcome<T> => ({ ok: true, data, error: null });
const fail = (code: string): Outcome<never> => ({ ok: false, data: null, error: { code, message: "", status: 409 } });
const APPLE_CRED: AppLinkCredentials = { provider: "APPLE", credentials: { identityToken: "it", authorizationCode: "c", nonce: "n".repeat(64) } };

function renderApp(props: Partial<{ inApp: boolean; appLink: boolean }> = {}) {
  return render(<SignInMethodsScreen inApp appLink appleEnabled emailEnabled={false} {...props} />);
}
async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("SignInMethodsScreen 앱 연결 (#198)", () => {
  beforeEach(() => {
    accounts = [KAKAO_ROW];
    for (const f of [show, refetch, check, link, requestAppLink, postToApp]) f.mockReset();
    check.mockResolvedValue(ok({ intent: "x" }));
  });
  afterEach(cleanup);

  it("성공: 확인 → 셸 네이티브 로그인 → 받은 값으로 POST, 토스트와 목록 새로고침. form 이 없다", async () => {
    requestAppLink.mockResolvedValue({ ok: true, ...APPLE_CRED });
    link.mockResolvedValue(ok({ absorbed: false }));
    const { container } = renderApp();
    expect(container.querySelector("form")).toBeNull();
    await press("Apple 연결");
    expect(check).toHaveBeenCalledWith("APPLE");
    expect(requestAppLink).toHaveBeenCalledWith("APPLE");
    expect(link).toHaveBeenCalledWith(APPLE_CRED);
    expect(show).toHaveBeenCalledWith("Apple을 연결했어요");
    expect(refetch).toHaveBeenCalled();
  });

  it("빈 계정 흡수 문구", async () => {
    accounts = [{ ...KAKAO_ROW, provider: "APPLE", label: "Apple ID" } as AuthAccount];
    requestAppLink.mockResolvedValue({ ok: true, provider: "KAKAO", credentials: { accessToken: "at" } });
    link.mockResolvedValue(ok({ absorbed: true }));
    renderApp();
    await press("카카오 연결");
    expect(link).toHaveBeenCalledWith({ provider: "KAKAO", credentials: { accessToken: "at" } });
    expect(show).toHaveBeenCalledWith("카카오를 연결하고 빈 계정을 합쳤어요");
  });

  it("사용자가 시트를 닫으면(cancelled) POST 도 토스트도 없다", async () => {
    requestAppLink.mockResolvedValue({ ok: false, reason: "cancelled" });
    renderApp();
    await press("Apple 연결");
    expect(link).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apple 연결" })).toBeTruthy();
  });

  it("시간 초과, 셸 오류는 제공자 실패 토스트, 못 씀은 '지금은 연결할 수 없어요'. POST 없음", async () => {
    requestAppLink.mockResolvedValueOnce({ ok: false, reason: "timeout" });
    renderApp();
    await press("Apple 연결");
    expect(show).toHaveBeenLastCalledWith("Apple 연결에 실패했어요. 잠시 후 다시 시도해 주세요");
    requestAppLink.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    await press("Apple 연결");
    expect(show).toHaveBeenLastCalledWith("지금은 연결할 수 없어요");
    expect(link).not.toHaveBeenCalled();
  });

  it("최근 로그인이 아니면(확인 단계 REAUTH_REQUIRED) 네이티브 시트를 띄우지 않고 다시 로그인 창", async () => {
    check.mockResolvedValue(fail("REAUTH_REQUIRED"));
    renderApp();
    await press("Apple 연결");
    expect(requestAppLink).not.toHaveBeenCalled();
    expect(screen.getByText("다시 로그인해 주세요")).toBeTruthy();
    expect(show).not.toHaveBeenCalled();
  });

  it("연결 단계 REAUTH_REQUIRED 도 다시 로그인 창, 다른 오류는 연결 실패 문구", async () => {
    requestAppLink.mockResolvedValue({ ok: true, ...APPLE_CRED });
    link.mockResolvedValueOnce(fail("REAUTH_REQUIRED"));
    renderApp();
    await press("Apple 연결");
    expect(screen.getByText("다시 로그인해 주세요")).toBeTruthy();
    link.mockResolvedValueOnce(fail("AUTH_ACCOUNT_IN_USE"));
    await press("Apple 연결");
    expect(show).toHaveBeenLastCalledWith("이 Apple 계정은 다른 달력에서 쓰고 있어요");
  });

  it("AccountLink/1 이 없는 옛 셸은 카카오, Apple 버튼이 없다", () => {
    accounts = [{ ...KAKAO_ROW, provider: "EMAIL", label: "k***@x.com" } as AuthAccount];
    renderApp({ appLink: false });
    expect(screen.queryByRole("button", { name: "카카오 연결" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apple 연결" })).toBeNull();
  });

  it("웹(앱 아님)은 지금처럼 form POST /me/link/start, 브리지를 쓰지 않는다", async () => {
    const { container } = renderApp({ inApp: false, appLink: false });
    const form = container.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/me/link/start");
    expect(container.querySelector('input[name="provider"]')?.getAttribute("value")).toBe("APPLE");
    expect(requestAppLink).not.toHaveBeenCalled();
  });
});
