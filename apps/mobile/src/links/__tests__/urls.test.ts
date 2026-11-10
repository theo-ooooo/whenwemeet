import { buildAuthAppUrl, decideNavigation, deepLinkToWebUrl, isWebOrigin, parseAuthReturn, parseSchemeLink, safeNext } from "../urls";

const WEB = "https://whenwemeet.day";

describe("isWebOrigin", () => {
  it.each([
    ["https://whenwemeet.day/", true],
    ["https://whenwemeet.day/g/3?x=1", true],
    ["http://whenwemeet.day/", false],
    ["https://api.whenwemeet.day/", false],
    ["https://whenwemeet.day.evil.com/", false],
    ["https://evil.com/?https://whenwemeet.day", false],
    ["not a url", false],
  ])("%s → %s", (url, ok) => expect(isWebOrigin(url, WEB)).toBe(ok));

  it("로컬 개발 http 오리진은 그 오리진만", () => {
    expect(isWebOrigin("http://192.168.0.10:3000/x", "http://192.168.0.10:3000")).toBe(true);
    expect(isWebOrigin("http://192.168.0.10:3001/x", "http://192.168.0.10:3000")).toBe(false);
  });
});

describe("decideNavigation", () => {
  it("웹 오리진은 허용", () => {
    expect(decideNavigation("https://whenwemeet.day/join/ABC123", WEB)).toEqual({ kind: "allow" });
    expect(decideNavigation("https://whenwemeet.day/auth/app?h=x&v=y", WEB)).toEqual({ kind: "allow" });
  });
  it("웹 카카오/애플 로그인 경로는 네이티브 로그인으로 (next 는 safeNext)", () => {
    expect(decideNavigation("https://whenwemeet.day/auth/kakao?next=/join/AB", WEB)).toEqual({
      kind: "nativeLogin",
      next: "/join/AB",
    });
    expect(decideNavigation("https://whenwemeet.day/auth/apple", WEB)).toEqual({ kind: "nativeLogin", next: "/" });
    expect(decideNavigation("https://whenwemeet.day/auth/kakao?next=//evil.com", WEB)).toEqual({
      kind: "nativeLogin",
      next: "/",
    });
  });
  it("/auth/app 은 /auth/apple 로 오인하지 않는다", () => {
    expect(decideNavigation("https://whenwemeet.day/auth/apple/x", WEB).kind).toBe("nativeLogin");
    expect(decideNavigation("https://whenwemeet.day/auth/applex", WEB).kind).toBe("allow");
  });
  it("다른 도메인과 스킴은 외부로", () => {
    expect(decideNavigation("https://kauth.kakao.com/oauth/authorize", WEB)).toEqual({
      kind: "external",
      url: "https://kauth.kakao.com/oauth/authorize",
    });
    expect(decideNavigation("tel:01012345678", WEB).kind).toBe("external");
    expect(decideNavigation("http://whenwemeet.day/", WEB).kind).toBe("external");
  });
  it("about:blank 허용, javascript: 와 잘못된 주소는 막음", () => {
    expect(decideNavigation("about:blank", WEB).kind).toBe("allow");
    expect(decideNavigation("javascript:alert(1)", WEB).kind).toBe("block");
    expect(decideNavigation("::::", WEB).kind).toBe("block");
  });
});

describe("safeNext", () => {
  it.each([
    [null, "/"],
    ["", "/"],
    ["/", "/"],
    ["/join/AB?auto=1", "/join/AB?auto=1"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["/a\nb", "/"],
    ["/" + "a".repeat(600), "/"],
  ])("%p → %p", (input, out) => expect(safeNext(input as string | null)).toBe(out));
});

describe("deepLinkToWebUrl", () => {
  it("초대 링크와 팀 달력 링크는 같은 경로를 웹 오리진에서", () => {
    expect(deepLinkToWebUrl("https://whenwemeet.day/join/ABC123", WEB)).toBe("https://whenwemeet.day/join/ABC123");
    expect(deepLinkToWebUrl("https://whenwemeet.day/join/ABC123?auto=1", WEB)).toBe(
      "https://whenwemeet.day/join/ABC123?auto=1",
    );
    expect(deepLinkToWebUrl("https://whenwemeet.day/g/12/events", WEB)).toBe("https://whenwemeet.day/g/12/events");
  });
  it("스테이징 웹 오리진으로 바꿔 연다", () => {
    expect(deepLinkToWebUrl("https://whenwemeet.day/join/ABC", "https://staging.example.com/")).toBe(
      "https://staging.example.com/join/ABC",
    );
  });
  it("커스텀 스킴 whenwemeet://join, //g 도 같은 경로로 (#154)", () => {
    expect(deepLinkToWebUrl("whenwemeet://join/ABC123", WEB)).toBe("https://whenwemeet.day/join/ABC123");
    expect(deepLinkToWebUrl("whenwemeet://join/ABC123?auto=1", WEB)).toBe("https://whenwemeet.day/join/ABC123?auto=1");
    expect(deepLinkToWebUrl("whenwemeet:///join/ABC123", WEB)).toBe("https://whenwemeet.day/join/ABC123");
    expect(deepLinkToWebUrl("whenwemeet://g/12/events?date=2026-11-10", WEB)).toBe(
      "https://whenwemeet.day/g/12/events?date=2026-11-10",
    );
    expect(deepLinkToWebUrl("whenwemeet://join/ABC", "https://staging.example.com/")).toBe(
      "https://staging.example.com/join/ABC",
    );
  });
  it("대상 밖 경로, 다른 호스트, 다른 스킴, auth 복귀는 null", () => {
    for (const u of [
      "https://whenwemeet.day/",
      "https://whenwemeet.day/login?next=/",
      "https://whenwemeet.day/join",
      "https://whenwemeet.day/join/",
      "https://whenwemeet.day/gallery",
      "https://evil.com/join/ABC",
      "http://whenwemeet.day/join/ABC",
      "whenwemeet://auth?h=x",
      "whenwemeet:///auth?h=x",
      "whenwemeet://",
      "whenwemeet://join",
      "whenwemeet://join/",
      "whenwemeet://login?next=/",
      "whenwemeet://gallery/1",
      "whenwemeet:////evil.com/join/AB",
      "otherapp://join/ABC",
      "garbage",
    ]) {
      expect(deepLinkToWebUrl(u, WEB)).toBeNull();
    }
  });
});

describe("parseSchemeLink", () => {
  it.each([
    ["whenwemeet://join/AB?x=1", { path: "/join/AB", search: "?x=1" }],
    ["whenwemeet:///join/AB", { path: "/join/AB", search: "" }],
    ["whenwemeet://", { path: "/", search: "" }],
    ["https://whenwemeet.day/join/AB", null],
    ["kakao123://oauth", null],
  ])("%p", (raw, out) => expect(parseSchemeLink(raw)).toEqual(out));
});

describe("buildAuthAppUrl", () => {
  it("h, v, next 를 쿼리로 (next 는 safeNext)", () => {
    const u = new URL(buildAuthAppUrl(WEB + "/", "H".repeat(43), "V".repeat(43), "/join/AB?auto=1"));
    expect(u.origin + u.pathname).toBe("https://whenwemeet.day/auth/app");
    expect(u.searchParams.get("h")).toBe("H".repeat(43));
    expect(u.searchParams.get("v")).toBe("V".repeat(43));
    expect(u.searchParams.get("next")).toBe("/join/AB?auto=1");
    expect(new URL(buildAuthAppUrl(WEB, "h", "v", "//evil")).searchParams.get("next")).toBe("/");
  });
});

describe("parseAuthReturn", () => {
  const h = "a".repeat(43);
  it("handoff 성공", () => {
    expect(parseAuthReturn(`whenwemeet://auth?h=${h}&next=/`)).toEqual({ ok: true, handoff: h });
    expect(parseAuthReturn(`whenwemeet:///auth?h=${h}`)).toEqual({ ok: true, handoff: h });
  });
  it("오류와 형식 위반", () => {
    expect(parseAuthReturn("whenwemeet://auth?error=APPLE_CANCELLED")).toEqual({ ok: false, error: "APPLE_CANCELLED" });
    expect(parseAuthReturn("whenwemeet://auth?h=short")).toEqual({ ok: false, error: "HANDOFF_INVALID" });
    expect(parseAuthReturn(`https://whenwemeet.day/auth?h=${h}`)).toBeNull();
    expect(parseAuthReturn(`whenwemeet://other?h=${h}`)).toBeNull();
  });
});

describe("RN URL 구현에서도 같은 결과 (#154)", () => {
  // RN 의 URL 은 http(s) 가 아니면 host, pathname 이 비어 커스텀 스킴을 못 읽는다. jest(Node URL) 만 믿지 않게 바꿔 끼워 본다
  const NodeURL = global.URL;
  beforeAll(() => {
    global.URL = jest.requireActual("react-native/Libraries/Blob/URL").URL;
  });
  afterAll(() => {
    global.URL = NodeURL;
  });
  it("커스텀 스킴과 https 둘 다", () => {
    expect(new URL("whenwemeet://join/AB").pathname).toBe("/"); // RN URL 한계 확인 (이게 바뀌면 이 블록을 다시 본다)
    expect(deepLinkToWebUrl("whenwemeet://join/ABC123?auto=1", WEB)).toBe("https://whenwemeet.day/join/ABC123?auto=1");
    expect(deepLinkToWebUrl("whenwemeet://g/12", WEB)).toBe("https://whenwemeet.day/g/12");
    expect(deepLinkToWebUrl("https://whenwemeet.day/join/ABC123?auto=1", WEB)).toBe(
      "https://whenwemeet.day/join/ABC123?auto=1",
    );
    expect(deepLinkToWebUrl("whenwemeet://auth?h=x", WEB)).toBeNull();
  });
});
