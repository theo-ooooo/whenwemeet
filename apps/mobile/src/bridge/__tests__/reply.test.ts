import { buildAppEventScript, buildLinkAccountReply, buildPushStatusReply, linkFailureReason, toPushPermission, validExpoToken } from "../reply";

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
  it("(#288) Android 13+ 묻지 않음(denied + canAskAgain true)은 물어볼 수 있는 상태(undetermined)", () => {
    expect(toPushPermission({ status: "denied", granted: false, canAskAgain: true })).toBe("undetermined");
    // 다시 물을 수 없을 때만 denied (iOS 거부, Android 두 번 거부). canAskAgain 이 없으면 지금처럼 denied
    expect(toPushPermission({ status: "denied", granted: false, canAskAgain: false })).toBe("denied");
    expect(toPushPermission({ status: "denied", granted: false })).toBe("denied");
    // 허용, 미정은 canAskAgain 과 상관없음
    expect(toPushPermission({ status: "granted", granted: true, canAskAgain: false })).toBe("granted");
    expect(toPushPermission({ status: "undetermined", granted: false, canAskAgain: true })).toBe("undetermined");
  });
  it("(#288) 웹 canAskPermission 과 같은 판정: 물어볼 수 있음 ⇔ undetermined", () => {
    // apps/web/src/lib/push.ts canAskPermission(permission, canAskAgain) 와 같은 식
    const webCanAsk = (perm: string, again: boolean) => perm === "undetermined" || (perm === "denied" && again);
    for (const status of ["granted", "denied", "undetermined"]) {
      for (const canAskAgain of [true, false]) {
        const p = { status, granted: status === "granted", canAskAgain };
        const perm = toPushPermission(p);
        if (perm !== "granted") expect(perm === "undetermined").toBe(webCanAsk(status, canAskAgain));
        // 셸 값을 웹이 다시 판정해도 결과가 같다
        expect(webCanAsk(perm, canAskAgain)).toBe(perm !== "granted" && webCanAsk(status, canAskAgain));
      }
    }
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

describe("(#198) linkAccount 응답 (앱.md 4.8)", () => {
  it("카카오 성공: accessToken 만 싣는다", () => {
    const cred = { provider: "KAKAO" as const, credentials: { accessToken: "kakao-at", refreshToken: "secret" } as { accessToken: string } };
    expect(buildLinkAccountReply("l1", cred)).toEqual({
      v: 1,
      type: "linkAccount",
      id: "l1",
      ok: true,
      provider: "KAKAO",
      credentials: { accessToken: "kakao-at" },
    });
  });
  it("Apple 성공: identityToken, authorizationCode, 원문 nonce 만 싣는다 (이름 등 다른 칸은 버린다)", () => {
    const credentials = { identityToken: "id.tok", authorizationCode: "code", nonce: "a".repeat(64), fullName: { givenName: "길동" } };
    expect(buildLinkAccountReply("l2", { provider: "APPLE", credentials })).toEqual({
      v: 1,
      type: "linkAccount",
      id: "l2",
      ok: true,
      provider: "APPLE",
      credentials: { identityToken: "id.tok", authorizationCode: "code", nonce: "a".repeat(64) },
    });
  });
  it("실패: reason 만", () => {
    expect(buildLinkAccountReply("l3", { reason: "cancelled" })).toEqual({ v: 1, type: "linkAccount", id: "l3", ok: false, reason: "cancelled" });
  });
  it("예외 → 이유: 취소는 cancelled, 키 없는 빌드와 Apple 못 쓰는 기기는 unavailable, 그 밖은 error", () => {
    const cancelled = Object.assign(new Error("cancelled"), { name: "LoginCancelled" });
    expect(linkFailureReason(cancelled)).toBe("cancelled");
    expect(linkFailureReason({ code: "KAKAO_NOT_CONFIGURED" })).toBe("unavailable");
    expect(linkFailureReason({ code: "APPLE_UNSUPPORTED" })).toBe("unavailable");
    expect(linkFailureReason({ code: "KAKAO_SDK" })).toBe("error");
    expect(linkFailureReason({ code: "APPLE_SDK" })).toBe("error");
    expect(linkFailureReason(new Error("x"))).toBe("error");
    expect(linkFailureReason(null)).toBe("error");
  });
  it("웹으로 보내는 스크립트에 응답이 JSON 으로 실린다", () => {
    const script = buildAppEventScript(buildLinkAccountReply("l1", { provider: "KAKAO", credentials: { accessToken: "t</script>" } }));
    expect(script).toContain('"type":"linkAccount"');
    expect(script).not.toContain("</script>");
  });
});
