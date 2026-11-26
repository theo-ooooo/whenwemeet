// (#378) 머리줄 ‹ 의 뒤로 판단: 앱 안 이동이 있었으면 뒤로, 아니면 fallback
import { describe, expect, it } from "vitest";
import { canGoBackInApp } from "../back-nav";

const O = "https://whenwemeet.day";
const ctx = (o: Partial<Parameters<typeof canGoBackInApp>[0]>) => ({
  historyLength: 3,
  initialUrl: `${O}/search`,
  currentUrl: `${O}/search`,
  referrer: "",
  ...o,
});

describe("canGoBackInApp", () => {
  it("기록이 하나뿐이면(새 탭, 앱 셸 첫 화면) 뒤로 가지 않는다", () => {
    expect(canGoBackInApp(ctx({ historyLength: 1, initialUrl: `${O}/calendar` }))).toBe(false);
  });

  it("처음 연 경로와 지금 경로가 다르면 앱 안 이동이 있었다", () => {
    expect(canGoBackInApp(ctx({ initialUrl: `${O}/calendar` }))).toBe(true);
  });

  it("검색어만 바뀐 같은 경로는 앱 안 이동이 아니다 (replaceState)", () => {
    expect(canGoBackInApp(ctx({ currentUrl: `${O}/search?q=치과` }))).toBe(false);
  });

  it("같은 경로면 같은 출처 referrer 일 때만", () => {
    expect(canGoBackInApp(ctx({ referrer: `${O}/calendar` }))).toBe(true);
    expect(canGoBackInApp(ctx({ referrer: "https://search.example.com/" }))).toBe(false);
    expect(canGoBackInApp(ctx({ initialUrl: null, referrer: "" }))).toBe(false);
  });

  it("주소가 이상해도 던지지 않는다", () => {
    expect(canGoBackInApp(ctx({ initialUrl: "::", referrer: "not a url" }))).toBe(false);
  });
});
