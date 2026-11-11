import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushStatus } from "../app-bridge";
import {
  claimPromptCheck,
  isPromptOpen,
  maybeOpenPushPrompt,
  parseLastPut,
  parsePromptRecord,
  PUSH_PROMPT_KEY,
  PUSH_PUT_INTERVAL_MS,
  resetPromptStateForTest,
  setPromptOpen,
  shouldPrompt,
  subscribePrompt,
  syncAction,
} from "../push";

const TOKEN = "ExponentPushToken[abc123]";
const status = (over: Partial<PushStatus> = {}): PushStatus => ({
  id: "p1",
  permission: "granted",
  canAskAgain: true,
  token: TOKEN,
  platform: "IOS",
  appVersion: "1.1.0",
  ...over,
});
const NOW = 1_800_000_000_000;

describe("syncAction (푸시-알림.md 2-3)", () => {
  it("허용 + 토큰이면 등록", () => {
    const a = syncAction(status(), null, null, NOW);
    expect(a.kind).toBe("put");
  });

  it("같은 토큰은 1시간 안이면 다시 등록하지 않는다", () => {
    expect(syncAction(status(), TOKEN, { token: TOKEN, at: NOW - 60_000 }, NOW).kind).toBe("none");
    expect(syncAction(status(), TOKEN, { token: TOKEN, at: NOW - PUSH_PUT_INTERVAL_MS }, NOW).kind).toBe("put");
    // 토큰이 바뀌었거나, 로컬 기록이 없으면(다른 탭에서 지움) 다시
    expect(syncAction(status({ token: "ExponentPushToken[new]" }), TOKEN, { token: TOKEN, at: NOW }, NOW).kind).toBe("put");
    expect(syncAction(status(), null, { token: TOKEN, at: NOW }, NOW).kind).toBe("put");
    // 시계가 뒤로 갔으면 다시
    expect(syncAction(status(), TOKEN, { token: TOKEN, at: NOW + 10_000 }, NOW).kind).toBe("put");
  });

  it("권한이 없거나 토큰이 없는데 등록한 토큰이 남아 있으면 지운다 (OS 에서 알림을 끈 기기)", () => {
    expect(syncAction(status({ permission: "denied", token: null }), TOKEN, null, NOW)).toEqual({ kind: "delete", token: TOKEN });
    expect(syncAction(status({ token: null }), TOKEN, null, NOW)).toEqual({ kind: "delete", token: TOKEN });
    expect(syncAction(status({ permission: "undetermined", token: null }), null, null, NOW).kind).toBe("none");
  });

  it("응답이 없으면(시간 초과, 옛 앱) 아무것도 하지 않는다", () => {
    expect(syncAction(null, TOKEN, null, NOW).kind).toBe("none");
  });
});

describe("shouldPrompt (8-1 조건 표)", () => {
  const cases: [boolean, PushStatus["permission"] | null, "accepted" | "later" | null, boolean][] = [
    [true, "undetermined", null, true],
    [true, "undetermined", "later", false],
    [true, "undetermined", "accepted", false],
    [true, "granted", null, false],
    [true, "denied", null, false],
    [true, null, null, false],
    [false, "undetermined", null, false],
  ];
  it.each(cases)("지원 %s, 권한 %s, 기록 %s → %s", (supported, permission, record, want) => {
    expect(shouldPrompt({ supported, permission, record })).toBe(want);
  });
});

describe("저장 값 읽기", () => {
  it("마지막 등록 기록", () => {
    expect(parseLastPut(JSON.stringify({ token: TOKEN, at: 5 }))).toEqual({ token: TOKEN, at: 5 });
    expect(parseLastPut("{")).toBeNull();
    expect(parseLastPut(JSON.stringify({ token: 1, at: 5 }))).toBeNull();
    expect(parseLastPut(null)).toBeNull();
  });
  it("시트 답 기록", () => {
    expect(parsePromptRecord("later")).toBe("later");
    expect(parsePromptRecord("accepted")).toBe("accepted");
    expect(parsePromptRecord("yes")).toBeNull();
    expect(parsePromptRecord(null)).toBeNull();
  });
});

describe("권한 안내 시트 열림 상태와 계기", () => {
  afterEach(() => {
    resetPromptStateForTest();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("구독자는 열림, 닫힘을 한 번씩 듣는다", () => {
    const l = vi.fn();
    const off = subscribePrompt(l);
    setPromptOpen(true);
    setPromptOpen(true);
    setPromptOpen(false);
    off();
    setPromptOpen(true);
    expect(l).toHaveBeenCalledTimes(2);
  });

  it("두 계기 중 먼저 오는 것 한 번만 확인한다", () => {
    expect(claimPromptCheck()).toBe(true);
    expect(claimPromptCheck()).toBe(false);
  });

  function stubApp(version: string, opts: { record?: string; permission?: string } = {}) {
    const listeners = new Map<string, (e: Event) => void>();
    const store = new Map<string, string>(opts.record ? [[PUSH_PROMPT_KEY, opts.record]] : []);
    const postMessage = vi.fn((raw: string) => {
      const m = JSON.parse(raw) as { id: string };
      const detail = { v: 1, type: "pushStatus", id: m.id, permission: opts.permission ?? "undetermined", canAskAgain: true, token: null, platform: "IOS", appVersion: version };
      queueMicrotask(() => listeners.get("wwm:app")?.({ detail } as unknown as Event));
    });
    vi.stubGlobal("navigator", { userAgent: `Mozilla/5.0 WhenwemeetApp/${version} (ios)` });
    vi.stubGlobal("window", {
      ReactNativeWebView: { postMessage },
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
      addEventListener: (n: string, f: (e: Event) => void) => listeners.set(n, f),
      removeEventListener: (n: string) => listeners.delete(n),
    });
    return postMessage;
  }

  it("1.1 앱, 권한 미정, 답한 적 없음 → 시트를 연다", async () => {
    const post = stubApp("1.1.0");
    await maybeOpenPushPrompt();
    expect(JSON.parse(post.mock.calls[0][0] as string)).toMatchObject({ v: 1, type: "pushStatus" });
    expect(isPromptOpen()).toBe(true);
  });

  it("[나중에] 기록이 있으면 셸에 묻지도 않는다", async () => {
    const post = stubApp("1.1.0", { record: "later" });
    await maybeOpenPushPrompt();
    expect(post).not.toHaveBeenCalled();
    expect(isPromptOpen()).toBe(false);
  });

  it("OS 에서 이미 허용한 기기는 띄우지 않는다", async () => {
    stubApp("1.2.0", { permission: "granted" });
    await maybeOpenPushPrompt();
    expect(isPromptOpen()).toBe(false);
  });

  it("1.0.x 앱은 새 메시지를 보내지 않는다 (D-81)", async () => {
    const post = stubApp("1.0.9");
    await maybeOpenPushPrompt();
    expect(post).not.toHaveBeenCalled();
    expect(isPromptOpen()).toBe(false);
  });
});
