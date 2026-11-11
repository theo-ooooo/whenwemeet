import { parseBridgeMessage, shareContent } from "../messages";

const WEB = "https://whenwemeet.day";
const SRC = "https://whenwemeet.day/login?next=/";
const p = (o: unknown, src = SRC) => parseBridgeMessage(JSON.stringify(o), src, WEB);

describe("parseBridgeMessage", () => {
  it("login: next 는 safeNext, reason 은 expired 만", () => {
    expect(p({ v: 1, type: "login" })).toEqual({ v: 1, type: "login", next: "/" });
    expect(p({ v: 1, type: "login", next: "/join/AB?auto=1", reason: "expired" })).toEqual({
      v: 1,
      type: "login",
      next: "/join/AB?auto=1",
      reason: "expired",
    });
    expect(p({ v: 1, type: "login", next: "https://evil.com", reason: "other" })).toEqual({
      v: 1,
      type: "login",
      next: "/",
    });
    expect(p({ v: 1, type: "login", next: 3 })).toBeNull();
  });

  it("logout, accountDeleted", () => {
    expect(p({ v: 1, type: "logout" })).toEqual({ v: 1, type: "logout" });
    expect(p({ v: 1, type: "accountDeleted", extra: 1 })).toEqual({ v: 1, type: "accountDeleted" });
  });

  it("share: url 은 웹 오리진만", () => {
    expect(p({ v: 1, type: "share", url: "https://whenwemeet.day/join/AB", text: "같이 써요", title: "초대" })).toEqual({
      v: 1,
      type: "share",
      url: "https://whenwemeet.day/join/AB",
      text: "같이 써요",
      title: "초대",
    });
    expect(p({ v: 1, type: "share", url: "https://evil.com/x" })).toBeNull();
    expect(p({ v: 1, type: "share" })).toBeNull();
    expect(p({ v: 1, type: "share", url: "https://whenwemeet.day/j", text: 5 })).toBeNull();
  });

  it("haptic: kind 목록만", () => {
    for (const kind of ["success", "light", "error"]) expect(p({ v: 1, type: "haptic", kind })).toEqual({ v: 1, type: "haptic", kind });
    expect(p({ v: 1, type: "haptic", kind: "heavy" })).toBeNull();
  });

  it("모르는 type, v 불일치, 깨진 JSON, 배열은 버린다", () => {
    expect(p({ v: 1, type: "push" })).toBeNull();
    expect(p({ v: 2, type: "logout" })).toBeNull();
    expect(p({ type: "logout" })).toBeNull();
    expect(parseBridgeMessage("{nope", SRC, WEB)).toBeNull();
    expect(parseBridgeMessage("[1]", SRC, WEB)).toBeNull();
    expect(parseBridgeMessage({ v: 1, type: "logout" }, SRC, WEB)).toBeNull();
    expect(parseBridgeMessage("x".repeat(5000), SRC, WEB)).toBeNull();
  });

  it("출처가 웹 오리진이 아니면 버린다", () => {
    expect(p({ v: 1, type: "logout" }, "https://evil.com/")).toBeNull();
    expect(p({ v: 1, type: "logout" }, "http://whenwemeet.day/")).toBeNull();
    expect(p({ v: 1, type: "logout" }, "about:blank")).toBeNull();
  });
});

describe("shareContent", () => {
  const msg = { url: "https://whenwemeet.day/join/AB", text: "같이 써요", title: "초대" };
  it("iOS 는 url 필드로", () => {
    expect(shareContent(msg, "ios")).toEqual({ message: "같이 써요", url: msg.url, title: "초대" });
  });
  it("Android 는 본문에 url 을 붙인다", () => {
    expect(shareContent(msg, "android")).toEqual({ message: "같이 써요\nhttps://whenwemeet.day/join/AB", title: "초대" });
    expect(shareContent({ url: msg.url }, "android")).toEqual({ message: msg.url });
  });
});

describe("parseBridgeMessage 푸시 (#188, 푸시-알림.md 2-2)", () => {
  it("pushStatus, pushRequest: id 1~40자", () => {
    expect(p({ v: 1, type: "pushStatus", id: "a1" })).toEqual({ v: 1, type: "pushStatus", id: "a1" });
    expect(p({ v: 1, type: "pushRequest", id: "x".repeat(40), extra: 1 })).toEqual({
      v: 1,
      type: "pushRequest",
      id: "x".repeat(40),
    });
  });

  it("잘못된 id 는 버린다 (없음, 빈 문자열, 41자, 숫자, 제어문자, 줄 구분자)", () => {
    for (const id of [undefined, "", "x".repeat(41), 7, "a\nb", "a\u2028b"]) {
      expect(p({ v: 1, type: "pushStatus", id })).toBeNull();
      expect(p({ v: 1, type: "pushRequest", id })).toBeNull();
    }
  });

  it("openSettings", () => {
    expect(p({ v: 1, type: "openSettings" })).toEqual({ v: 1, type: "openSettings" });
  });

  it("다른 출처, 다른 버전은 버린다", () => {
    expect(p({ v: 1, type: "pushStatus", id: "a" }, "https://evil.com/")).toBeNull();
    expect(p({ v: 1, type: "openSettings" }, "https://whenwemeet.day.evil.com/")).toBeNull();
    expect(p({ v: 2, type: "pushRequest", id: "a" })).toBeNull();
  });
});
