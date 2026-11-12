import { afterEach, describe, expect, it, vi } from "vitest";
import { currentVersionInfo, formatVersionInfo } from "../version-info";

const APP_UA =
  "Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 WhenwemeetApp/1.2.0 (android) EmailLogin/1";
const WEB_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("formatVersionInfo (#333)", () => {
  it("웹 버전, 커밋 7자리, 앱 버전을 모두 쓴다", () => {
    expect(formatVersionInfo({ webVersion: "0.15.0", commitSha: "abcdef1234567890", appVersion: "1.2.0" })).toBe(
      "언제볼까 웹 v0.15.0 (abcdef1), 앱 1.2.0",
    );
  });

  it("커밋이 없거나 비면 괄호를 뺀다", () => {
    expect(formatVersionInfo({ webVersion: "0.15.0", appVersion: "1.2.0" })).toBe("언제볼까 웹 v0.15.0, 앱 1.2.0");
    expect(formatVersionInfo({ webVersion: "0.15.0", commitSha: "  ", appVersion: "1.2.0" })).toBe("언제볼까 웹 v0.15.0, 앱 1.2.0");
  });

  it("앱이 아니면 앱 조각을 뺀다", () => {
    expect(formatVersionInfo({ webVersion: "0.15.0", commitSha: "abcdef1", appVersion: null })).toBe("언제볼까 웹 v0.15.0 (abcdef1)");
    expect(formatVersionInfo({ webVersion: "0.15.0" })).toBe("언제볼까 웹 v0.15.0");
  });

  it("7자리보다 짧은 커밋은 그대로 쓴다", () => {
    expect(formatVersionInfo({ webVersion: "0.15.0", commitSha: "abc" })).toBe("언제볼까 웹 v0.15.0 (abc)");
  });

  it("웹 버전이 비면 0.0.0 으로 둔다 (빌드 주입이 빠진 경우)", () => {
    expect(formatVersionInfo({ webVersion: "" })).toBe("언제볼까 웹 v0.0.0");
  });
});

describe("currentVersionInfo (#333)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("빌드 주입 값과 앱 UA 를 합친다", () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_VERSION", "0.14.0");
    vi.stubEnv("NEXT_PUBLIC_COMMIT_SHA", "abcdef1234567");
    expect(currentVersionInfo(APP_UA)).toBe("언제볼까 웹 v0.14.0 (abcdef1), 앱 1.2.0");
    expect(currentVersionInfo(WEB_UA)).toBe("언제볼까 웹 v0.14.0 (abcdef1)");
    expect(currentVersionInfo(null)).toBe("언제볼까 웹 v0.14.0 (abcdef1)");
  });

  it("커밋 주입이 비면 괄호 없이", () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_VERSION", "0.14.0");
    vi.stubEnv("NEXT_PUBLIC_COMMIT_SHA", "");
    expect(currentVersionInfo(APP_UA)).toBe("언제볼까 웹 v0.14.0, 앱 1.2.0");
  });
});
