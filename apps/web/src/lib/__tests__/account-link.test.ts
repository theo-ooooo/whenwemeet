import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_LINK_UA_TOKEN,
  appLinkFailureMessage,
  decodeLinkAccountReply,
  requestAppLink,
  appSupportsAccountLink,
  linkableProviders,
  linkedMessage,
  linkErrorMessage,
  linkReturnPath,
  readLinkResult,
  unlinkConfirmBody,
} from "../account-link";

const APP_UA = "Mozilla/5.0 (iPhone) WhenwemeetApp/1.2.0 (ios) EmailLogin/1";

describe("(#198) 로그인 방법 연결 버튼", () => {
  const base = { inApp: false, appLink: false, appleEnabled: true, emailEnabled: true, linked: [] as string[] };

  it("웹: 카카오, Apple, 이메일 순. 이미 연결된 제공자는 뺀다", () => {
    expect(linkableProviders(base)).toEqual(["KAKAO", "APPLE", "EMAIL"]);
    expect(linkableProviders({ ...base, linked: ["KAKAO", "EMAIL"] })).toEqual(["APPLE"]);
  });

  it("앱 셸: AccountLink/1 이 없으면 카카오, Apple 은 숨기고 이메일만 (웹 링크 경로를 셸이 가로챈다)", () => {
    expect(linkableProviders({ ...base, inApp: true })).toEqual(["EMAIL"]);
    expect(linkableProviders({ ...base, inApp: true, appLink: true })).toEqual(["KAKAO", "APPLE", "EMAIL"]);
  });

  it("앱 셸 + AccountLink/1: 이미 연결된 것만 빼고, Android 앱(Apple 스위치 꺼짐)은 카카오와 이메일", () => {
    const app = { ...base, inApp: true, appLink: true };
    expect(linkableProviders({ ...app, linked: ["KAKAO"] })).toEqual(["APPLE", "EMAIL"]);
    expect(linkableProviders({ ...app, appleEnabled: false })).toEqual(["KAKAO", "EMAIL"]);
    expect(linkableProviders({ ...app, appleEnabled: false, emailEnabled: false, linked: ["KAKAO"] })).toEqual([]);
  });

  it("Apple 은 웹 Apple 스위치(Android 앱은 꺼짐), 이메일은 이메일 스위치", () => {
    expect(linkableProviders({ ...base, appleEnabled: false, emailEnabled: false })).toEqual(["KAKAO"]);
  });

  it("UA 능력 토큰은 앱 셸 UA 에서만", () => {
    expect(appSupportsAccountLink(APP_UA)).toBe(false);
    expect(appSupportsAccountLink(`${APP_UA} ${ACCOUNT_LINK_UA_TOKEN}`)).toBe(true);
    expect(appSupportsAccountLink(`Mozilla/5.0 Chrome ${ACCOUNT_LINK_UA_TOKEN}`)).toBe(false);
    expect(appSupportsAccountLink(`${APP_UA} AccountLink/10`)).toBe(false);
    expect(appSupportsAccountLink(null)).toBe(false);
  });
});

describe("(#198) 결과 주소와 문구", () => {
  it("next 가 규칙 밖이거나 / 면 로그인 방법 화면. 앞 결과는 지우고 새 결과를 싣는다", () => {
    expect(linkReturnPath("https://evil.example", { linked: "KAKAO" })).toBe("/me/accounts?linked=KAKAO");
    expect(linkReturnPath("//evil", { error: "X" })).toBe("/me/accounts?link_error=X");
    expect(linkReturnPath(null, { linked: "APPLE", absorbed: true })).toBe("/me/accounts?linked=APPLE&absorbed=1");
    expect(linkReturnPath("/me/accounts?provider=KAKAO&link_error=OLD", { error: "AUTH_ACCOUNT_IN_USE" })).toBe(
      "/me/accounts?provider=KAKAO&link_error=AUTH_ACCOUNT_IN_USE",
    );
    expect(linkReturnPath("/me/accounts", { provider: "APPLE" })).toBe("/me/accounts?provider=APPLE");
  });

  it("주소의 결과 → 토스트. 사용자 취소는 문구 없음", () => {
    expect(readLinkResult(new URLSearchParams("linked=KAKAO"))).toEqual({ message: "카카오를 연결했어요", tone: "ok" });
    expect(readLinkResult(new URLSearchParams("linked=APPLE&absorbed=1"))?.message).toBe("Apple을 연결하고 빈 계정을 합쳤어요");
    expect(readLinkResult(new URLSearchParams("provider=KAKAO&link_error=AUTH_ACCOUNT_IN_USE"))?.message).toBe("이 카카오 계정은 다른 달력에서 쓰고 있어요");
    expect(readLinkResult(new URLSearchParams("link_error=AUTH_ACCOUNT_IN_USE"))?.message).toBe("이 계정은 다른 달력에서 쓰고 있어요");
    expect(readLinkResult(new URLSearchParams("link_error=APPLE_CANCELLED"))).toBeNull();
    expect(readLinkResult(new URLSearchParams(""))).toBeNull();
  });

  it("문구는 짧게, 조사 맞춤", () => {
    expect(linkedMessage("EMAIL", false)).toBe("이메일을 연결했어요");
    expect(linkErrorMessage("PROVIDER_ALREADY_LINKED", "KAKAO")).toBe("카카오는 이미 연결돼 있어요");
    expect(linkErrorMessage("REAUTH_REQUIRED")).toBe("보안을 위해 다시 로그인해 주세요");
    expect(linkErrorMessage("LINK_TICKET_INVALID")).toBe("연결 시간이 지났어요. 다시 시도해 주세요");
    expect(linkErrorMessage("WHATEVER")).toBe("연결하지 못했어요. 잠시 후 다시 시도해 주세요");
    expect(unlinkConfirmBody("KAKAO")).toBe("카카오로는 더 이상 로그인할 수 없어요");
  });
});

describe("(#198) 앱 셸 linkAccount 응답 읽기 (앱.md 4.8)", () => {
  const nonce = "n".repeat(64);
  it("카카오, Apple 성공은 쓰는 칸만", () => {
    expect(decodeLinkAccountReply({ v: 1, type: "linkAccount", id: "l1", ok: true, provider: "KAKAO", credentials: { accessToken: "at", x: 1 } })).toEqual({
      id: "l1",
      outcome: { ok: true, provider: "KAKAO", credentials: { accessToken: "at" } },
    });
    expect(
      decodeLinkAccountReply({ v: 1, type: "linkAccount", id: "l2", ok: true, provider: "APPLE", credentials: { identityToken: "it", authorizationCode: "c", nonce } }),
    ).toEqual({ id: "l2", outcome: { ok: true, provider: "APPLE", credentials: { identityToken: "it", authorizationCode: "c", nonce } } });
  });
  it("실패 이유는 cancelled, unavailable 그대로, 모르는 이유와 틀린 성공은 error", () => {
    expect(decodeLinkAccountReply({ v: 1, type: "linkAccount", id: "l1", ok: false, reason: "cancelled" })?.outcome).toEqual({ ok: false, reason: "cancelled" });
    expect(decodeLinkAccountReply({ v: 1, type: "linkAccount", id: "l1", ok: false, reason: "unavailable" })?.outcome).toEqual({ ok: false, reason: "unavailable" });
    expect(decodeLinkAccountReply({ v: 1, type: "linkAccount", id: "l1", ok: false, reason: "weird" })?.outcome).toEqual({ ok: false, reason: "error" });
    expect(decodeLinkAccountReply({ v: 1, type: "linkAccount", id: "l1", ok: true, provider: "KAKAO", credentials: {} })?.outcome).toEqual({ ok: false, reason: "error" });
    expect(
      decodeLinkAccountReply({ v: 1, type: "linkAccount", id: "l1", ok: true, provider: "APPLE", credentials: { identityToken: "it", authorizationCode: "c", nonce: "n".repeat(129) } })?.outcome,
    ).toEqual({ ok: false, reason: "error" });
  });
  it("다른 type, 버전, id 없음, 배열은 null", () => {
    expect(decodeLinkAccountReply({ v: 1, type: "pushStatus", id: "l1", ok: false })).toBeNull();
    expect(decodeLinkAccountReply({ v: 2, type: "linkAccount", id: "l1", ok: false })).toBeNull();
    expect(decodeLinkAccountReply({ v: 1, type: "linkAccount", ok: false })).toBeNull();
    expect(decodeLinkAccountReply({ v: 1, type: "linkAccount", id: "l1" })).toBeNull();
    expect(decodeLinkAccountReply([])).toBeNull();
    expect(decodeLinkAccountReply(null)).toBeNull();
  });
  it("셸 실패 문구: 취소는 빈 문자열, 못 씀은 '지금은 연결할 수 없어요', 그 밖은 제공자 실패", () => {
    expect(appLinkFailureMessage("cancelled", "KAKAO")).toBe("");
    expect(appLinkFailureMessage("unavailable", "APPLE")).toBe("지금은 연결할 수 없어요");
    expect(appLinkFailureMessage("error", "KAKAO")).toBe("카카오 연결에 실패했어요. 잠시 후 다시 시도해 주세요");
    expect(appLinkFailureMessage("timeout", "APPLE")).toBe("Apple 연결에 실패했어요. 잠시 후 다시 시도해 주세요");
  });
});

describe("(#198) requestAppLink: 셸에 보내고 같은 id 응답을 기다린다", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stubApp(reply: ((id: string, provider: string) => Record<string, unknown> | null) | null, ua = `${APP_UA} ${ACCOUNT_LINK_UA_TOKEN}`) {
    const listeners = new Set<(e: Event) => void>();
    const postMessage = vi.fn((raw: string) => {
      const m = JSON.parse(raw) as { type: string; id: string; provider: string };
      if (!reply) return;
      const detail = reply(m.id, m.provider);
      if (detail) queueMicrotask(() => listeners.forEach((l) => l({ detail } as unknown as Event)));
    });
    vi.stubGlobal("navigator", { userAgent: ua });
    vi.stubGlobal("window", {
      ReactNativeWebView: { postMessage },
      addEventListener: (_: string, f: (e: Event) => void) => listeners.add(f),
      removeEventListener: (_: string, f: (e: Event) => void) => listeners.delete(f),
    });
    return { postMessage, listeners };
  }

  it("linkAccount { v, id, provider } 를 보내고 성공 응답을 돌려준다. 끝나면 듣기를 그만둔다", async () => {
    const { postMessage, listeners } = stubApp((id, provider) => ({ v: 1, type: "linkAccount", id, ok: true, provider, credentials: { accessToken: "at" } }));
    await expect(requestAppLink("KAKAO")).resolves.toEqual({ ok: true, provider: "KAKAO", credentials: { accessToken: "at" } });
    const sent = JSON.parse(postMessage.mock.calls[0][0]) as Record<string, unknown>;
    expect(sent).toMatchObject({ v: 1, type: "linkAccount", provider: "KAKAO" });
    expect(typeof sent.id).toBe("string");
    expect(listeners.size).toBe(0);
  });

  it("다른 id 응답은 무시하고, 시간이 지나면 timeout", async () => {
    vi.useFakeTimers();
    stubApp(() => ({ v: 1, type: "linkAccount", id: "other", ok: false, reason: "cancelled" }));
    const p = requestAppLink("APPLE", 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("앱이 아니면(브리지 없음) 바로 unavailable", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome" });
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    await expect(requestAppLink("KAKAO")).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
