import { afterEach, describe, expect, it, vi } from "vitest";
import { appSupportsKakaoShare, KAKAO_SHARE_UA_TOKEN } from "../app-bridge";
import {
  INVITE_KAKAO_BUTTON,
  INVITE_KAKAO_DESCRIPTION,
  inviteKakaoFeed,
  KAKAO_SDK_INTEGRITY,
  KAKAO_SDK_URL,
  kakaoFeedTemplate,
  preloadKakaoSdk,
  shareKakaoFeed,
} from "../kakao-share";

const ORIGIN = "https://whenwemeet.day";
const BY = "AbC-_12345";
const group = (over: Partial<Parameters<typeof inviteKakaoFeed>[0]> = {}) => ({
  name: "우리 팀",
  inviteCode: "ABC123",
  inviteUrl: `${ORIGIN}/join/ABC123`,
  inviteShareUrl: `${ORIGIN}/join/ABC123?by=${BY}`,
  me: { displayName: "민지" },
  ...over,
});

describe("kakaoFeedTemplate (#195)", () => {
  it("피드 템플릿: 카드와 버튼이 같은 주소, 이미지 기본 1200×630, 실행 파라미터 없음", () => {
    const t = kakaoFeedTemplate({
      title: "제목",
      description: "설명",
      imageUrl: `${ORIGIN}/og`,
      link: `${ORIGIN}/join/ABC123`,
      buttonTitle: "초대 수락하기",
    });
    const link = { webUrl: `${ORIGIN}/join/ABC123`, mobileWebUrl: `${ORIGIN}/join/ABC123` };
    expect(t).toEqual({
      objectType: "feed",
      content: { title: "제목", description: "설명", imageUrl: `${ORIGIN}/og`, imageWidth: 1200, imageHeight: 630, link },
      buttons: [{ title: "초대 수락하기", link }],
    });
    expect(JSON.stringify(t)).not.toContain("ExecutionParams");
  });

  it("긴 제목, 설명, 버튼은 말줄임 (이모지 1자), 공백은 하나로", () => {
    const t = kakaoFeedTemplate({
      title: "가".repeat(150),
      description: "  여러   칸  ",
      imageUrl: "x",
      link: "y",
      buttonTitle: "😀".repeat(20),
    });
    expect(Array.from(t.content.title)).toHaveLength(100);
    expect(t.content.title.endsWith("…")).toBe(true);
    expect(t.content.description).toBe("여러 칸");
    expect(Array.from(t.buttons[0].title)).toHaveLength(14);
  });
});

describe("inviteKakaoFeed (#195, D-159 와 같은 문구)", () => {
  it("내 표식이 있으면 '내 이름님이 팀 팀에 초대했어요', 이미지는 같은 OG 카드 + by", () => {
    expect(inviteKakaoFeed(group())).toEqual({
      title: "민지님이 우리 팀 팀에 초대했어요",
      description: INVITE_KAKAO_DESCRIPTION,
      imageUrl: `${ORIGIN}/og/join/ABC123?by=${BY}`,
      imageWidth: 1200,
      imageHeight: 630,
      link: `${ORIGIN}/join/ABC123?by=${BY}`,
      buttonTitle: INVITE_KAKAO_BUTTON,
    });
  });

  it("표식이 없으면(옛 API) '팀 팀에 초대받았어요', 이미지에 by 없음", () => {
    const f = inviteKakaoFeed(group({ inviteShareUrl: null }));
    expect(f?.title).toBe("우리 팀 팀에 초대받았어요");
    expect(f?.imageUrl).toBe(`${ORIGIN}/og/join/ABC123`);
    expect(f?.link).toBe(`${ORIGIN}/join/ABC123`);
  });

  it("팀 이름 특수문자는 그대로(템플릿은 JSON 이라 이스케이프 불필요), 이미지 주소의 코드는 인코딩", () => {
    const f = inviteKakaoFeed(group({ name: `<b>"우리"</b> & 'co' 🐶`, inviteCode: "A/B" }));
    expect(f?.title).toBe(`민지님이 <b>"우리"</b> & 'co' 🐶 팀에 초대했어요`);
    expect(f?.imageUrl).toBe(`${ORIGIN}/og/join/A%2FB?by=${BY}`);
  });

  it("긴 팀 이름(24자), 긴 내 이름(20자)은 OG 카드처럼 말줄임", () => {
    const f = inviteKakaoFeed(group({ name: "가".repeat(40), me: { displayName: "나".repeat(30) } }));
    expect(f?.title).toBe(`${"나".repeat(19)}…님이 ${"가".repeat(23)}… 팀에 초대했어요`);
  });

  it("미리보기 오리진은 공유 주소를 따른다 (프리뷰, 로컬)", () => {
    const f = inviteKakaoFeed(
      group({ inviteUrl: "http://localhost:3000/join/ABC123", inviteShareUrl: `http://localhost:3000/join/ABC123?by=${BY}` }),
    );
    expect(f?.imageUrl).toBe(`http://localhost:3000/og/join/ABC123?by=${BY}`);
  });

  it("코드나 주소가 없으면(개인 팀) null, 틀린 표식은 없는 것으로", () => {
    expect(inviteKakaoFeed(group({ inviteCode: null }))).toBeNull();
    expect(inviteKakaoFeed(group({ inviteUrl: null, inviteShareUrl: null }))).toBeNull();
    expect(inviteKakaoFeed(group({ inviteShareUrl: `${ORIGIN}/join/ABC123?by=bad` }))?.title).toBe("우리 팀 팀에 초대받았어요");
  });
});

describe("앱 셸 카카오 공유 표시 (D-169)", () => {
  const OLD = "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 WhenwemeetApp/1.1.0 (ios) EmailLogin/1";
  it("UA 토큰 KakaoShare/1 이 있는 셸만", () => {
    expect(appSupportsKakaoShare(`Mozilla/5.0 WhenwemeetApp/1.1.1 (ios) EmailLogin/1 ${KAKAO_SHARE_UA_TOKEN}`)).toBe(true);
    expect(appSupportsKakaoShare(OLD)).toBe(false);
    expect(appSupportsKakaoShare("Mozilla/5.0 Safari KakaoShare/1")).toBe(false);
    expect(appSupportsKakaoShare(`${OLD} KakaoShare/10`)).toBe(false);
    expect(appSupportsKakaoShare(`${OLD} XKakaoShare/1`)).toBe(false);
    expect(appSupportsKakaoShare(null)).toBe(false);
  });
});

describe("shareKakaoFeed", () => {
  const feed = inviteKakaoFeed(group())!;
  const APP_NEW = `Mozilla/5.0 WhenwemeetApp/1.1.1 (android) EmailLogin/1 ${KAKAO_SHARE_UA_TOKEN}`;
  const APP_OLD = "Mozilla/5.0 WhenwemeetApp/1.1.0 (android) EmailLogin/1";
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("새 셸이면 브리지 kakaoShare (템플릿 + OS 공유 폴백 본문), SDK 는 건드리지 않는다", async () => {
    const postMessage = vi.fn();
    const createElement = vi.fn();
    vi.stubGlobal("navigator", { userAgent: APP_NEW });
    vi.stubGlobal("window", { ReactNativeWebView: { postMessage } });
    vi.stubGlobal("document", { createElement });
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "k");
    expect(await shareKakaoFeed(feed, "본문")).toBe(true);
    const sent = JSON.parse(postMessage.mock.calls[0][0]);
    expect(sent).toEqual({ v: 1, type: "kakaoShare", template: kakaoFeedTemplate(feed), text: "본문" });
    expect(postMessage.mock.calls[0][0].length).toBeLessThan(4096);
    expect(createElement).not.toHaveBeenCalled();
  });

  it("옛 셸(1.1.0)이면 false, 메시지도 SDK 도 없음 (호출부가 share 브리지로)", async () => {
    const postMessage = vi.fn();
    const createElement = vi.fn();
    vi.stubGlobal("navigator", { userAgent: APP_OLD });
    vi.stubGlobal("window", { ReactNativeWebView: { postMessage } });
    vi.stubGlobal("document", { createElement });
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "k");
    expect(await shareKakaoFeed(feed)).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("브라우저에 키가 없으면 false (지금 동작)", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Safari" });
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "");
    expect(await shareKakaoFeed(feed)).toBe(false);
  });

  it("브라우저: SDK 를 고정 버전, SRI 로 붙이고 init → sendDefault", async () => {
    const sendDefault = vi.fn();
    const init = vi.fn();
    const win: Record<string, unknown> = {};
    const script: Record<string, unknown> = { remove: vi.fn() };
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Safari" });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {
      createElement: () => script,
      head: {
        appendChild: () => {
          // 실제 SDK 2.x 처럼 init 전에는 Share 가 없다
          const kakao: Record<string, unknown> = { isInitialized: () => false };
          kakao.init = (key: string) => {
            init(key);
            kakao.Share = { sendDefault };
          };
          win.Kakao = kakao;
          (script.onload as () => void)();
        },
      },
    });
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "js-key");
    expect(await shareKakaoFeed(feed)).toBe(true);
    expect(script.src).toBe(KAKAO_SDK_URL);
    expect(script.integrity).toBe(KAKAO_SDK_INTEGRITY);
    expect(script.crossOrigin).toBe("anonymous");
    expect(init).toHaveBeenCalledWith("js-key");
    expect(sendDefault).toHaveBeenCalledWith(kakaoFeedTemplate(feed));
  });

  it("브라우저: SDK 로드 실패, sendDefault 예외는 false", async () => {
    const win: Record<string, unknown> = {};
    const script: Record<string, unknown> = { remove: vi.fn() };
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Safari" });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { createElement: () => script, head: { appendChild: () => (script.onerror as () => void)() } });
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "js-key");
    expect(await shareKakaoFeed(feed)).toBe(false);
    expect(script.remove).toHaveBeenCalled();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    win.Kakao = {
      isInitialized: () => true,
      init: vi.fn(),
      Share: {
        sendDefault: () => {
          throw new Error("domain");
        },
      },
    };
    expect(await shareKakaoFeed(feed)).toBe(false);
    warn.mockRestore();
  });
});

describe("preloadKakaoSdk", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("앱 셸 안이나 키가 없으면 스크립트를 붙이지 않는다", () => {
    const createElement = vi.fn();
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("navigator", { userAgent: `Mozilla/5.0 WhenwemeetApp/1.1.1 (ios) ${KAKAO_SHARE_UA_TOKEN}` });
    vi.stubGlobal("window", { ReactNativeWebView: { postMessage: vi.fn() } });
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "k");
    preloadKakaoSdk();
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Safari" });
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "");
    preloadKakaoSdk();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("브라우저 + 키면 한 번 붙이고, 받는 중에는 다시 붙이지 않는다", () => {
    const appendChild = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ remove: vi.fn() }), head: { appendChild } });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Safari" });
    vi.stubGlobal("window", {});
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "k");
    preloadKakaoSdk();
    preloadKakaoSdk();
    expect(appendChild).toHaveBeenCalledTimes(1);
  });
});
