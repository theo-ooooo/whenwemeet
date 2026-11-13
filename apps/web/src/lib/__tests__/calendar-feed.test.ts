// (#193) 구독 칸 판정과 문구
import { describe, expect, it } from "vitest";
import { feedOnNote, feedPlatform, feedSheetPoints, lastFetchedText } from "../calendar-feed";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

describe("feedPlatform", () => {
  it("iPhone 은 애플 + 폰, Mac 은 애플(컴퓨터), iPadOS 사파리는 터치로 가른다", () => {
    expect(feedPlatform(UA.iphone)).toEqual({ apple: true, mobile: true });
    expect(feedPlatform(UA.mac)).toEqual({ apple: true, mobile: false });
    expect(feedPlatform(UA.ipadDesktop, 5)).toEqual({ apple: true, mobile: true });
  });

  it("Android, 윈도우는 애플 버튼을 숨긴다. Android 는 폰", () => {
    expect(feedPlatform(UA.android)).toEqual({ apple: false, mobile: true });
    expect(feedPlatform(UA.windows)).toEqual({ apple: false, mobile: false });
  });

  it("앱 셸은 UA 접미사의 os 를 따른다", () => {
    expect(feedPlatform(`${UA.iphone} WhenwemeetApp/1.2.0 (ios)`)).toEqual({ apple: true, mobile: true });
    expect(feedPlatform(`${UA.android} WhenwemeetApp/1.2.0 (android)`)).toEqual({ apple: false, mobile: true });
  });
});

describe("문구", () => {
  it("마지막으로 가져간 시간: 없으면 아직, 있으면 상대 시각", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    expect(lastFetchedText(null, now)).toBe("아직 가져가지 않았어요");
    expect(lastFetchedText("2026-11-13T09:00:00Z", now)).toBe("마지막으로 가져간 시간: 3시간 전");
  });

  it("고지: 팀은 제목, 시간, 참여자 이름, 개인은 제목과 시간. 메모는 기본으로 안 나간다", () => {
    expect(feedSheetPoints(false)[0]).toContain("이 팀 일정의 제목, 시간, 참여자 이름을");
    expect(feedSheetPoints(true)[0]).toContain("내 일정의 제목과 시간을");
    expect(feedSheetPoints(false)[1]).toContain("메모는 나가지 않아요");
    expect(feedOnNote(false)).toBe("주소를 아는 사람은 누구나 이 팀 일정을 볼 수 있어요");
    expect(feedOnNote(true)).toBe("주소를 아는 사람은 누구나 내 일정을 볼 수 있어요");
  });
});
