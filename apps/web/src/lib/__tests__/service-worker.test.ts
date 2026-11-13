// (#203) 서비스 워커 등록 판정 (D-256)
import { describe, expect, it } from "vitest";
import { serviceWorkerAction, serviceWorkerUrl } from "../service-worker";

const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const APP = `${CHROME} WhenwemeetApp/1.2.0 (android) EmailLogin/1`;
const IOS_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 WhenwemeetApp/1.1.0 (ios)";
const base = { ua: CHROME, supported: true, secure: true, production: true };

describe("serviceWorkerAction", () => {
  it("운영 빌드, 보안 출처 브라우저면 등록", () => {
    expect(serviceWorkerAction(base)).toBe("register");
  });

  it("앱 셸 UA 면 등록하지 않고 해제 (iOS, Android)", () => {
    expect(serviceWorkerAction({ ...base, ua: APP })).toBe("unregister");
    expect(serviceWorkerAction({ ...base, ua: IOS_APP })).toBe("unregister");
    expect(serviceWorkerAction({ ...base, ua: APP, production: false })).toBe("unregister");
  });

  it("지원하지 않거나 개발 서버, 보안 출처가 아니면 아무것도 안 함", () => {
    expect(serviceWorkerAction({ ...base, supported: false })).toBe("skip");
    expect(serviceWorkerAction({ ...base, supported: false, ua: APP })).toBe("skip");
    expect(serviceWorkerAction({ ...base, production: false })).toBe("skip");
    expect(serviceWorkerAction({ ...base, secure: false })).toBe("skip");
    expect(serviceWorkerAction({ ...base, ua: null })).toBe("register");
  });
});

describe("serviceWorkerUrl", () => {
  it("버전을 ?v= 로 싣고, 없으면 dev", () => {
    expect(serviceWorkerUrl("abc123def456")).toBe("/sw.js?v=abc123def456");
    expect(serviceWorkerUrl("0.20.0-mh1x")).toBe("/sw.js?v=0.20.0-mh1x");
    expect(serviceWorkerUrl(undefined)).toBe("/sw.js?v=dev");
    expect(serviceWorkerUrl("")).toBe("/sw.js?v=dev");
    expect(serviceWorkerUrl("a&b=<c>")).toBe("/sw.js?v=abc");
  });
});
