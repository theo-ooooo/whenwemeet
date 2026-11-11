import { describe, expect, it } from "vitest";
import { invitePreviewPath, inviteShare, parseInviteBy } from "../invite-share";
import { inviteOgImage } from "../site";

describe("inviteShare (#196, D-159)", () => {
  const base = { name: "우리 팀", inviteUrl: "https://whenwemeet.day/join/ABC123" };

  it("주소는 내 표식이 붙은 inviteShareUrl, 없으면 inviteUrl, 둘 다 없으면 빈 문자열", () => {
    expect(inviteShare({ ...base, inviteShareUrl: `${base.inviteUrl}?by=AbC-_12345` }).url).toBe(`${base.inviteUrl}?by=AbC-_12345`);
    expect(inviteShare({ ...base, inviteShareUrl: null }).url).toBe(base.inviteUrl);
    expect(inviteShare({ name: "x", inviteUrl: null, inviteShareUrl: null }).url).toBe("");
  });

  it("문구는 로그인 수단을 가리지 않는다, text 는 문구 + 줄바꿈 + 주소", () => {
    const s = inviteShare({ ...base, inviteShareUrl: `${base.inviteUrl}?by=AbC-_12345` });
    expect(s.message).toBe("'우리 팀' 달력에 초대할게요. 링크를 열고 로그인하면 바로 합류돼요");
    expect(s.message).not.toContain("카카오");
    expect(s.text).toBe(`${s.message}\n${s.url}`);
    expect(s.title).toBe("언제볼까 초대");
  });
});

describe("parseInviteBy / invitePreviewPath", () => {
  it("base64url 10자 문자열만 통과", () => {
    expect(parseInviteBy("AbC-_12345")).toBe("AbC-_12345");
    for (const bad of [undefined, null, "", "short", "AbC-_123456", "AbC+/12345", "한글한글한글한글한글", ["AbC-_12345"]]) {
      expect(parseInviteBy(bad)).toBeNull();
    }
  });

  it("코드는 인코딩, by 는 있을 때만", () => {
    expect(invitePreviewPath("ABC123", null)).toBe("/invites/ABC123");
    expect(invitePreviewPath("ABC123", "AbC-_12345")).toBe("/invites/ABC123?by=AbC-_12345");
    expect(invitePreviewPath("A/B", null)).toBe("/invites/A%2FB");
  });

  it("inviteOgImage 는 by 를 쿼리로 싣는다 (route handler 가 읽음)", () => {
    expect(inviteOgImage("ABC123").url).toBe("/og/join/ABC123");
    expect(inviteOgImage("ABC123", "AbC-_12345").url).toBe("/og/join/ABC123?by=AbC-_12345");
  });
});
