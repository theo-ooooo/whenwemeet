import { describe, expect, it } from "vitest";
import {
  eventShareAutoNext,
  eventShareExpiryLabel,
  eventShareKakaoFeed,
  eventShareLandingHref,
  eventShareMetaTitle,
  eventSharePreviewPath,
  eventShareRepeatLabel,
  eventShareText,
  eventShareTimeLabel,
  isShareEnded,
  parseEventShareToken,
} from "../event-share";
import { safeNext } from "../auth";
import { eventShareOgImage } from "../site";

const kst = (v: string) => new Date(`${v}+09:00`).toISOString();
const TOKEN = "Ab3_-Ab3_-Ab3_-Ab3_-AB";

describe("eventShareTimeLabel (#274)", () => {
  it("시간 일정 하루: 오전/오후가 같으면 끝에 생략, 다르면 붙인다. 정오와 자정", () => {
    expect(eventShareTimeLabel({ startsAt: kst("2026-11-15T19:00:00"), endsAt: kst("2026-11-15T21:00:00"), allDay: false })).toBe("11월 15일 (일) 오후 7:00 ~ 9:00");
    expect(eventShareTimeLabel({ startsAt: kst("2026-11-14T11:30:00"), endsAt: kst("2026-11-14T13:00:00"), allDay: false })).toBe("11월 14일 (토) 오전 11:30 ~ 오후 1:00");
    expect(eventShareTimeLabel({ startsAt: kst("2026-11-14T00:00:00"), endsAt: kst("2026-11-14T12:00:00"), allDay: false })).toBe("11월 14일 (토) 오전 12:00 ~ 오후 12:00");
  });

  it("종일 하루, 여러 날(같은 달, 달 넘김), 여러 날 시간 일정", () => {
    expect(eventShareTimeLabel({ startsAt: kst("2026-11-14T00:00:00"), endsAt: kst("2026-11-15T00:00:00"), allDay: true })).toBe("11월 14일 (토) 종일");
    expect(eventShareTimeLabel({ startsAt: kst("2026-11-14T00:00:00"), endsAt: kst("2026-11-17T00:00:00"), allDay: true })).toBe("11월 14일 (토) ~ 16일 (월)");
    expect(eventShareTimeLabel({ startsAt: kst("2026-11-30T00:00:00"), endsAt: kst("2026-12-03T00:00:00"), allDay: true })).toBe("11월 30일 (월) ~ 12월 2일 (수)");
    expect(eventShareTimeLabel({ startsAt: kst("2026-11-14T22:00:00"), endsAt: kst("2026-11-15T02:00:00"), allDay: false })).toBe("11월 14일 (토) 오후 10:00 ~ 15일 (일) 오전 2:00");
  });

  it("반복 표시", () => {
    expect(eventShareRepeatLabel("WEEKLY")).toBe("매주 반복 일정");
    expect(eventShareRepeatLabel("BIWEEKLY")).toBe("격주 반복 일정");
    expect(eventShareRepeatLabel(null)).toBeNull();
  });
});

describe("토큰, 경로, 착지", () => {
  it("토큰은 base64url 22자만", () => {
    expect(parseEventShareToken(TOKEN)).toBe(TOKEN);
    for (const bad of [undefined, null, "", "short", `${TOKEN}A`, "Ab3+/Ab3_-Ab3_-Ab3_-AB", "가".repeat(22)]) expect(parseEventShareToken(bad)).toBeNull();
    expect(eventSharePreviewPath(TOKEN)).toBe(`/event-shares/${TOKEN}`);
  });

  it("자동 합류 next 는 로그인 next 검사를 통과한다", () => {
    expect(eventShareAutoNext(TOKEN)).toBe(`/join/e/${TOKEN}?auto=1`);
    expect(safeNext(eventShareAutoNext(TOKEN))).toBe(eventShareAutoNext(TOKEN));
  });

  it("달력 착지: 날짜 + 일 상세 + 일정, 반복이면 회차까지. 오늘이면 date 를 뗀다", () => {
    expect(eventShareLandingHref({ groupId: 3, eventId: 9, occurrence: null, date: "2026-11-15" }, "2026-11-12")).toBe("/g/3/calendar?date=2026-11-15&day=1&event=9");
    expect(eventShareLandingHref({ groupId: 3, eventId: 9, occurrence: "2026-11-18", date: "2026-11-19" }, "2026-11-12")).toBe(
      "/g/3/calendar?date=2026-11-19&day=1&event=9&occurrence=2026-11-18",
    );
    expect(eventShareLandingHref({ groupId: 3, eventId: 9, occurrence: null, date: "2026-11-12" }, "2026-11-12")).toBe("/g/3/calendar?day=1&event=9");
  });
});

describe("보내는 쪽 문구와 카드", () => {
  const ev = { title: "토요일 저녁", startsAt: kst("2026-11-14T19:00:00"), endsAt: kst("2026-11-14T21:00:00"), allDay: false };
  const link = { token: TOKEN, url: `https://whenwemeet.day/join/e/${TOKEN}`, expiresAt: kst("2026-11-15T21:00:00") };

  it("공유 문구: 제목과 시각, 본문 + 줄바꿈 + 주소", () => {
    const t = eventShareText(link, ev);
    expect(t.message).toBe("'토요일 저녁' 11월 14일 (토) 오후 7:00 ~ 9:00, 같이 볼래요? 언제볼까에서 일정 보기");
    expect(t.text).toBe(`${t.message}\n${link.url}`);
    expect(t.url).toBe(link.url);
  });

  it("카카오 카드: 이미지는 같은 오리진의 OG 카드, 버튼 '일정 보기'. 주소가 틀리면 null", () => {
    expect(eventShareKakaoFeed(link, ev, "저녁 모임")).toEqual({
      title: "토요일 저녁",
      description: "11월 14일 (토) 오후 7:00 ~ 9:00, 저녁 모임 팀 일정",
      imageUrl: `https://whenwemeet.day/og/join/e/${TOKEN}`,
      imageWidth: 1200,
      imageHeight: 630,
      link: link.url,
      buttonTitle: "일정 보기",
    });
    expect(eventShareKakaoFeed({ ...link, url: "nope" }, ev, "x")).toBeNull();
    expect(eventShareOgImage(TOKEN).url).toBe(`/og/join/e/${TOKEN}`);
  });

  it("만료 안내는 KST 날짜, 자정 만료는 그 전날까지", () => {
    expect(eventShareExpiryLabel(kst("2026-11-15T21:00:00"))).toBe("이 링크는 11월 15일까지 열려요");
    expect(eventShareExpiryLabel(kst("2026-11-16T00:00:00"))).toBe("이 링크는 11월 15일까지 열려요");
  });

  it("끝난 회차, 메타 제목", () => {
    expect(isShareEnded(kst("2026-11-14T21:00:00"), new Date(kst("2026-11-14T21:00:00")).getTime())).toBe(true);
    expect(isShareEnded(kst("2026-11-14T21:00:00"), new Date(kst("2026-11-14T20:59:00")).getTime())).toBe(false);
    expect(eventShareMetaTitle({ groupName: "저녁 모임", event: { ...ev, repeat: null, occurrence: null } })).toBe("토요일 저녁 - 저녁 모임");
  });
});
