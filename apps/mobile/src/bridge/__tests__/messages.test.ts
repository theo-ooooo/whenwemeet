import { parseBridgeMessage, parseKakaoFeed, shareContent } from "../messages";

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

describe("kakaoShare (#195, D-169)", () => {
  const url = "https://whenwemeet.day/join/ABC123?by=AbC-_12345";
  const link = { webUrl: url, mobileWebUrl: url };
  // 웹 lib/kakao-share.ts kakaoFeedTemplate 이 만드는 모양
  const template = {
    objectType: "feed",
    content: {
      title: "민지님이 우리 팀 팀에 초대했어요",
      description: "합류하면 같은 달력을 함께 보고, 모두 비는 시간을 바로 찾아요",
      imageUrl: "https://whenwemeet.day/og/join/ABC123?by=AbC-_12345",
      imageWidth: 1200,
      imageHeight: 630,
      link,
    },
    buttons: [{ title: "초대 수락하기", link }],
  };
  const expected = {
    content: { ...template.content },
    buttons: template.buttons,
  };

  it("웹이 만든 템플릿을 그대로 받고 objectType 은 뗀다, text 는 OS 공유 폴백 본문", () => {
    expect(p({ v: 1, type: "kakaoShare", template, text: "같이 써요" })).toEqual({
      v: 1,
      type: "kakaoShare",
      template: expected,
      text: "같이 써요",
    });
    expect(p({ v: 1, type: "kakaoShare", template })).toEqual({ v: 1, type: "kakaoShare", template: expected });
  });

  it("출처 밖 주소(카드 링크, 버튼 링크, 이미지)가 하나라도 있으면 버린다", () => {
    const evil = "https://evil.com/join/ABC123";
    const bad = [
      { ...template, content: { ...template.content, imageUrl: "https://evil.com/a.png" } },
      { ...template, content: { ...template.content, imageUrl: "http://whenwemeet.day/og" } },
      { ...template, content: { ...template.content, link: { webUrl: url, mobileWebUrl: evil } } },
      { ...template, buttons: [{ title: "초대 수락하기", link: { webUrl: evil, mobileWebUrl: evil } }] },
      { ...template, buttons: [{ title: "초대 수락하기", link: { webUrl: "javascript:alert(1)" } }] },
    ];
    for (const t of bad) expect(p({ v: 1, type: "kakaoShare", template: t })).toBeNull();
  });

  it("실행 파라미터 같은 모르는 칸은 버리고, 한쪽 링크만 있으면 다른 쪽으로 채운다", () => {
    const t = {
      ...template,
      content: { ...template.content, link: { webUrl: url, androidExecutionParams: { a: "1" } } },
      buttons: [{ title: "초대 수락하기", link: { mobileWebUrl: url, iosExecutionParams: { a: "1" } } }],
      social: { likeCount: 1 },
    };
    expect(parseKakaoFeed(t, WEB)).toEqual(expected);
  });

  it("모양이 틀리면 null: feed 아님, 제목 없음, 버튼 0개 또는 3개, 이미지 크기 이상, 제어문자", () => {
    const bad: unknown[] = [
      null,
      [],
      { ...template, objectType: "list" },
      { ...template, content: { ...template.content, title: "" } },
      { ...template, content: { ...template.content, title: "a\nb" } },
      { ...template, content: { ...template.content, imageWidth: -1 } },
      { ...template, content: { ...template.content, imageHeight: 1.5 } },
      { ...template, content: { ...template.content, description: 3 } },
      { ...template, buttons: [] },
      { ...template, buttons: [template.buttons[0], template.buttons[0], template.buttons[0]] },
      { ...template, buttons: [{ title: "가".repeat(21), link }] },
    ];
    for (const t of bad) expect(parseKakaoFeed(t, WEB)).toBeNull();
    expect(p({ v: 1, type: "kakaoShare", template, text: 3 })).toBeNull();
  });

  it("다른 출처 페이지가 보낸 메시지는 버린다", () => {
    expect(p({ v: 1, type: "kakaoShare", template }, "https://evil.com/")).toBeNull();
  });

  it("설명, 이미지 크기는 없어도 된다", () => {
    const { description: _d, imageWidth: _w, imageHeight: _h, ...content } = template.content;
    expect(parseKakaoFeed({ ...template, content }, WEB)).toEqual({ content, buttons: template.buttons });
  });
});

describe("(#197) widgetSnapshot, widgetClear", () => {
  const snapshot = {
    generatedAt: "2026-11-12T00:00:00.000Z",
    groups: [{ id: 1, name: "우리 둘", color: 0, code: "team1xxx" }],
    days: [{ date: "2026-11-12", events: [{ g: 1, title: "저녁", time: "19:00" }], total: 1 }],
    anniversaries: [{ g: 1, title: "100일", date: "2026-11-20" }],
  };

  it("검사를 통과한 스냅샷만", () => {
    expect(p({ v: 1, type: "widgetSnapshot", snapshot })).toEqual({ v: 1, type: "widgetSnapshot", snapshot });
    expect(p({ v: 1, type: "widgetSnapshot", snapshot: { ...snapshot, groups: [] } })).toBeNull();
    expect(p({ v: 1, type: "widgetSnapshot" })).toBeNull();
    expect(p({ v: 1, type: "widgetClear" })).toEqual({ v: 1, type: "widgetClear" });
  });

  it("위젯 스냅샷만 4KB 넘게 받고 16KB 는 넘지 못한다", () => {
    const pad = (n: number) => ({ ...snapshot, generatedAt: snapshot.generatedAt, groups: [{ id: 1, name: "우리 둘", color: 0, code: "team1xxx" }], filler: "x".repeat(n) });
    expect(p({ v: 1, type: "widgetSnapshot", snapshot: pad(10_000) })?.type).toBe("widgetSnapshot");
    expect(p({ v: 1, type: "widgetSnapshot", snapshot: pad(17_000) })).toBeNull();
    expect(p({ v: 1, type: "logout", filler: "x".repeat(5_000) })).toBeNull();
  });

  it("출처가 웹 오리진이 아니면 버린다", () => {
    expect(p({ v: 1, type: "widgetSnapshot", snapshot }, "https://evil.com/")).toBeNull();
    expect(p({ v: 1, type: "widgetClear" }, "https://evil.com/")).toBeNull();
  });
});

describe("(#419) pullRefresh", () => {
  it("allow 가 boolean 일 때만", () => {
    expect(p({ v: 1, type: "pullRefresh", allow: false })).toEqual({ v: 1, type: "pullRefresh", allow: false });
    expect(p({ v: 1, type: "pullRefresh", allow: true })).toEqual({ v: 1, type: "pullRefresh", allow: true });
    expect(p({ v: 1, type: "pullRefresh", allow: "no" })).toBeNull();
    expect(p({ v: 1, type: "pullRefresh" })).toBeNull();
  });
  it("다른 출처는 버린다", () => {
    expect(p({ v: 1, type: "pullRefresh", allow: false }, "https://evil.com/")).toBeNull();
  });
});
