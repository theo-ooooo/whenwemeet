import { buildAuthAppUrl, buildEmailLoginUrl, buildUserAgentSuffix, decideNavigation, deepLinkToWebUrl, isWebOrigin, notificationTarget, parseSchemeLink, safeNext } from "../urls";

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
  it("(#274) 일정 공유 링크 /join/e/<토큰> 은 기존 /join 앱 링크로 열린다 (네이티브 변경 없음)", () => {
    const token = "Ab3_-Ab3_-Ab3_-Ab3_-AB";
    expect(deepLinkToWebUrl(`https://whenwemeet.day/join/e/${token}`, WEB)).toBe(`https://whenwemeet.day/join/e/${token}`);
    expect(deepLinkToWebUrl(`https://whenwemeet.day/join/e/${token}?auto=1`, WEB)).toBe(`https://whenwemeet.day/join/e/${token}?auto=1`);
    expect(deepLinkToWebUrl(`whenwemeet://join/e/${token}`, WEB)).toBe(`https://whenwemeet.day/join/e/${token}`);
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
  });
  it("(#311) 커스텀 스킴은 새 화면 주소도 연다 (위젯 누름). https 는 /join 과 옛 /g 만", () => {
    expect(deepLinkToWebUrl("whenwemeet://calendar?date=2026-11-12&day=1&team=k3x9ab12", WEB)).toBe("https://whenwemeet.day/calendar?date=2026-11-12&day=1&team=k3x9ab12");
    expect(deepLinkToWebUrl("whenwemeet://anniversaries?team=k3x9ab12", WEB)).toBe("https://whenwemeet.day/anniversaries?team=k3x9ab12");
    expect(deepLinkToWebUrl("whenwemeet://events/evntcode?team=k3x9ab12", WEB)).toBe("https://whenwemeet.day/events/evntcode?team=k3x9ab12");
    expect(deepLinkToWebUrl("whenwemeet://team/import", WEB)).toBe("https://whenwemeet.day/team/import");
    // 코드 없는 /join, /g 와 모르는 화면은 그대로 null
    expect(deepLinkToWebUrl("whenwemeet://join", WEB)).toBeNull();
    expect(deepLinkToWebUrl("whenwemeet://me", WEB)).toBeNull();
    expect(deepLinkToWebUrl("whenwemeet://calendars", WEB)).toBeNull();
    // https 새 주소는 앱 링크가 아니다 (AASA, intentFilters 에 없다)
    expect(deepLinkToWebUrl("https://whenwemeet.day/calendar?team=k3x9ab12", WEB)).toBeNull();
    expect(deepLinkToWebUrl("https://whenwemeet.day/events/evntcode", WEB)).toBeNull();
    expect(deepLinkToWebUrl("https://whenwemeet.day/join/ABC123?auto=1", WEB)).toBe(
      "https://whenwemeet.day/join/ABC123?auto=1",
    );
    expect(deepLinkToWebUrl("whenwemeet://auth?h=x", WEB)).toBeNull();
  });
});

describe("notificationTarget (#188, 푸시-알림.md 9장)", () => {
  const W = "https://whenwemeet.day";
  it("웹 경로만 받아 webOrigin 을 붙인다", () => {
    expect(notificationTarget({ url: "/g/3/calendar?date=2026-11-12&day=1&event=9", kind: "REMINDER" }, W)).toEqual({
      path: "/g/3/calendar?date=2026-11-12&day=1&event=9",
      url: "https://whenwemeet.day/g/3/calendar?date=2026-11-12&day=1&event=9",
    });
    expect(notificationTarget({ url: "/g/3/news" }, `${W}/`)?.url).toBe("https://whenwemeet.day/g/3/news");
    // (#311) 새 알림 주소 모양
    expect(notificationTarget({ url: "/events/evntcode?team=k3x9ab12&occurrence=2026-11-12", kind: "REMINDER" }, W)?.url).toBe(
      "https://whenwemeet.day/events/evntcode?team=k3x9ab12&occurrence=2026-11-12",
    );
  });

  it("절대 주소, //, 백슬래시, 제어문자, 없음은 null", () => {
    for (const url of [
      "https://whenwemeet.day/g/3/news",
      "https://evil.com/",
      "//evil.com/x",
      "/\\evil.com",
      "/g/3\n",
      "javascript:alert(1)",
      "",
      3,
      undefined,
    ]) {
      expect(notificationTarget({ url }, W)).toBeNull();
    }
    expect(notificationTarget(null, W)).toBeNull();
    expect(notificationTarget("x", W)).toBeNull();
  });
});

describe("(#245) 이메일 로그인 (이메일-로그인.md 7장, D-116)", () => {
  it("웹뷰가 여는 /login/email 주소. next 는 safeNext 후 인코딩, / 면 생략", () => {
    expect(buildEmailLoginUrl("https://whenwemeet.day/", "/")).toBe("https://whenwemeet.day/login/email");
    expect(buildEmailLoginUrl("https://whenwemeet.day", "/join/ABC123?auto=1")).toBe(
      "https://whenwemeet.day/login/email?next=%2Fjoin%2FABC123%3Fauto%3D1",
    );
    expect(buildEmailLoginUrl("https://whenwemeet.day", "//evil.com")).toBe("https://whenwemeet.day/login/email");
  });
  it("웹뷰가 /login/email 과 /auth/email 을 가로채지 않는다 (네이티브 로그인은 /auth/kakao, /auth/apple, /login 만)", () => {
    const W = "https://whenwemeet.day";
    expect(decideNavigation(`${W}/login/email?next=%2F`, W)).toEqual({ kind: "allow" });
    expect(decideNavigation(`${W}/login/email/nickname`, W)).toEqual({ kind: "allow" });
    expect(decideNavigation(`${W}/auth/email?token=${"a".repeat(43)}`, W)).toEqual({ kind: "allow" });
  });
  it("(#195) 카카오 키가 있는 빌드만 UA 끝에 KakaoShare/1 (웹 appSupportsKakaoShare 와 같은 식)", () => {
    expect(buildUserAgentSuffix("1.1.1", "ios", true)).toBe("WhenwemeetApp/1.1.1 (ios) EmailLogin/1 KakaoShare/1 Widget/1 DeviceCalendar/1");
    expect(buildUserAgentSuffix("1.1.1", "android", false)).toBe("WhenwemeetApp/1.1.1 (android) EmailLogin/1 Widget/1 DeviceCalendar/1");
    const re = /(?:^|\s)KakaoShare\/1(?:\s|$)/;
    expect(re.test(`Mozilla/5.0 ${buildUserAgentSuffix("1.1.1", "android", true)}`)).toBe(true);
    expect(/(?:^|\s)EmailLogin\/1(?:\s|$)/.test(buildUserAgentSuffix("1.1.1", "ios", true))).toBe(true);
  });

  it("(#198) 카카오 키가 있는 빌드만 UA 끝에 AccountLink/1 (웹 appSupportsAccountLink 와 같은 식)", () => {
    expect(buildUserAgentSuffix("1.2.0", "ios", true, true)).toBe("WhenwemeetApp/1.2.0 (ios) EmailLogin/1 KakaoShare/1 Widget/1 AccountLink/1 DeviceCalendar/1");
    expect(buildUserAgentSuffix("1.2.0", "android", false, false)).toBe("WhenwemeetApp/1.2.0 (android) EmailLogin/1 Widget/1 DeviceCalendar/1");
    expect(buildUserAgentSuffix("1.2.0", "ios", true)).not.toContain("AccountLink");
    const re = /(?:^|\s)AccountLink\/1(?:\s|$)/;
    expect(re.test(`Mozilla/5.0 ${buildUserAgentSuffix("1.2.0", "android", true, true)}`)).toBe(true);
    expect(re.test(`Mozilla/5.0 ${buildUserAgentSuffix("1.2.0", "android", true, false)}`)).toBe(false);
    // 다른 토큰 판정을 깨지 않는다
    expect(/(?:^|\s)Widget\/1(?:\s|$)/.test(buildUserAgentSuffix("1.2.0", "ios", true, true))).toBe(true);
  });

  it("UA 접미사 끝에 EmailLogin/1, 앞부분은 웹 APP_UA 정규식 그대로", () => {
    const ua = buildUserAgentSuffix("1.1.0", "ios");
    expect(ua).toBe("WhenwemeetApp/1.1.0 (ios) EmailLogin/1 Widget/1 DeviceCalendar/1");
    // 웹 apps/web/src/lib/app-bridge.ts 의 APP_UA, appSupportsEmailLogin 과 같은 식
    expect(/\bWhenwemeetApp\/([0-9A-Za-z.+-]+) \((ios|android)\)/.exec(`Mozilla/5.0 ${ua}`)?.[2]).toBe("ios");
    expect(/(?:^|\s)EmailLogin\/1(?:\s|$)/.test(`Mozilla/5.0 ${buildUserAgentSuffix("1.1.0", "android")}`)).toBe(true);
  });
});

describe("(D-178) /login 문서 이동은 웹 화면 대신 네이티브 로그인", () => {
  it("next 는 safeNext, reason=expired 는 그대로", () => {
    expect(decideNavigation(`${WEB}/login`, WEB)).toEqual({ kind: "nativeLogin", next: "/" });
    expect(decideNavigation(`${WEB}/login/`, WEB)).toEqual({ kind: "nativeLogin", next: "/" });
    expect(decideNavigation(`${WEB}/login?next=%2Fjoin%2FAB`, WEB)).toEqual({ kind: "nativeLogin", next: "/join/AB" });
    expect(decideNavigation(`${WEB}/login?next=//evil.com`, WEB)).toEqual({ kind: "nativeLogin", next: "/" });
    expect(decideNavigation(`${WEB}/login?next=%2F&reason=expired`, WEB)).toEqual({
      kind: "nativeLogin",
      next: "/",
      reason: "expired",
    });
    expect(decideNavigation(`${WEB}/login?reason=other`, WEB)).toEqual({ kind: "nativeLogin", next: "/" });
  });
  it("오류 문구가 있는 /login, /login/email, 비슷한 경로, 다른 오리진은 가로채지 않는다", () => {
    expect(decideNavigation(`${WEB}/login?error=HANDOFF_INVALID`, WEB)).toEqual({ kind: "allow" });
    expect(decideNavigation(`${WEB}/login/email`, WEB)).toEqual({ kind: "allow" });
    expect(decideNavigation(`${WEB}/loginx`, WEB)).toEqual({ kind: "allow" });
    expect(decideNavigation(`${WEB}/me/login`, WEB)).toEqual({ kind: "allow" });
    expect(decideNavigation("https://evil.com/login", WEB).kind).toBe("external");
  });
});

describe("(#271) 메일 로그인 링크 /auth/email 은 웹뷰로", () => {
  const TOKEN = "a".repeat(43);
  it("https 링크는 같은 주소를 웹 오리진에서 (토큰 쿼리 유지)", () => {
    expect(deepLinkToWebUrl(`https://whenwemeet.day/auth/email?token=${TOKEN}`, WEB)).toBe(
      `${WEB}/auth/email?token=${TOKEN}`,
    );
    expect(deepLinkToWebUrl(`https://whenwemeet.day/auth/email?token=${TOKEN}`, "https://staging.whenwemeet.day/")).toBe(
      `https://staging.whenwemeet.day/auth/email?token=${TOKEN}`,
    );
  });
  it("정확히 /auth/email 만. 하위 경로, 비슷한 경로, 커스텀 스킴, 다른 호스트, http 는 null", () => {
    for (const u of [
      `https://whenwemeet.day/auth/email/link?token=${TOKEN}`,
      `https://whenwemeet.day/auth/emailx?token=${TOKEN}`,
      `https://whenwemeet.day/auth/kakao`,
      `whenwemeet://auth/email?token=${TOKEN}`,
      `whenwemeet:///auth/email?token=${TOKEN}`,
      `https://evil.com/auth/email?token=${TOKEN}`,
      `http://whenwemeet.day/auth/email?token=${TOKEN}`,
    ]) {
      expect(deepLinkToWebUrl(u, WEB)).toBeNull();
    }
  });
  it("웹뷰가 연 /auth/email 과 확인 POST 는 가로채지 않는다", () => {
    expect(decideNavigation(`${WEB}/auth/email?token=${TOKEN}`, WEB)).toEqual({ kind: "allow" });
    expect(decideNavigation(`${WEB}/auth/email/link`, WEB)).toEqual({ kind: "allow" });
  });
});
