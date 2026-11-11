import { buildAppEventScript, buildPushStatusReply, toPushPermission, validExpoToken } from "../reply";

const TOKEN = "ExponentPushToken[abc_DEF-123]";

describe("toPushPermission", () => {
  it("OS 권한 → 브리지 값", () => {
    expect(toPushPermission({ status: "granted", granted: true })).toBe("granted");
    expect(toPushPermission({ status: "denied", granted: false })).toBe("denied");
    expect(toPushPermission({ status: "undetermined", granted: false })).toBe("undetermined");
    // iOS 임시 허용(provisional), ephemeral 도 알림이 온다
    expect(toPushPermission({ status: "undetermined", granted: false, ios: { status: 3 } })).toBe("granted");
    expect(toPushPermission({ status: "undetermined", granted: false, ios: { status: 4 } })).toBe("granted");
    expect(toPushPermission({ status: "weird" })).toBe("undetermined");
  });
});

describe("validExpoToken", () => {
  it("Expo 토큰 모양만 (API 7-1 과 같은 규칙)", () => {
    expect(validExpoToken(TOKEN)).toBe(TOKEN);
    expect(validExpoToken("ExpoPushToken[x]")).toBe("ExpoPushToken[x]");
    expect(validExpoToken("abc")).toBeNull();
    expect(validExpoToken("ExponentPushToken[]")).toBeNull();
    expect(validExpoToken(null)).toBeNull();
  });
});

describe("buildPushStatusReply", () => {
  const base = { id: "r1", canAskAgain: true, os: "ios" as const, appVersion: "1.1.0" };

  it("허용이면 토큰, 플랫폼 대문자, 앱 버전", () => {
    expect(buildPushStatusReply({ ...base, permission: "granted", token: TOKEN })).toEqual({
      v: 1,
      type: "pushStatus",
      id: "r1",
      permission: "granted",
      canAskAgain: true,
      token: TOKEN,
      platform: "IOS",
      appVersion: "1.1.0",
    });
    expect(buildPushStatusReply({ ...base, os: "android", permission: "granted", token: null }).platform).toBe(
      "ANDROID",
    );
  });

  it("허용이 아니면 토큰을 싣지 않는다, 모양이 틀린 토큰도 null", () => {
    expect(buildPushStatusReply({ ...base, permission: "denied", canAskAgain: false, token: TOKEN }).token).toBeNull();
    expect(buildPushStatusReply({ ...base, permission: "undetermined", token: TOKEN }).token).toBeNull();
    expect(buildPushStatusReply({ ...base, permission: "granted", token: "garbage" }).token).toBeNull();
  });
});

describe("buildAppEventScript", () => {
  it("wwm:app CustomEvent 로 detail 을 그대로 보낸다", () => {
    const detail = buildPushStatusReply({
      id: "r1",
      permission: "granted",
      canAskAgain: true,
      token: TOKEN,
      os: "android",
      appVersion: "1.1.0",
    });
    const script = buildAppEventScript(detail);
    const events: { type: string; detail: unknown }[] = [];
    const win = { dispatchEvent: (e: { type: string; detail: unknown }) => events.push(e) };
    class CustomEvent {
      type: string;
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) {
        this.type = type;
        this.detail = init.detail;
      }
    }
    expect(new Function("window", "CustomEvent", `return ${script.replace(/true;$/, "0")}`)(win, CustomEvent)).toBe(
      undefined,
    );
    expect(events).toEqual([{ type: "wwm:app", detail }]);
    expect(script.endsWith("true;")).toBe(true);
  });

  it("id 에 따옴표, </script>, 줄 구분자가 있어도 스크립트를 깨지 않는다", () => {
    const detail = buildPushStatusReply({
      id: "'\"</script>\u2028",
      permission: "denied",
      canAskAgain: false,
      token: null,
      os: "ios",
      appVersion: "1.1.0",
    });
    const script = buildAppEventScript(detail);
    expect(script).not.toContain("</script>");
    expect(script).not.toContain("\u2028");
    let got: unknown;
    new Function("window", "CustomEvent", script)(
      { dispatchEvent: (e: { detail: unknown }) => (got = e.detail) },
      function (this: { detail: unknown }, _t: string, init: { detail: unknown }) {
        this.detail = init.detail;
      },
    );
    expect(got).toEqual(detail);
  });
});
