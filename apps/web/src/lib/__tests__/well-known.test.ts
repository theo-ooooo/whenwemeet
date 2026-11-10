import { describe, expect, it } from "vitest";
import { buildAppleAppSiteAssociation, buildAssetLinks, parseFingerprints, wellKnownResponse } from "../well-known";

const FP1 = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
const FP2 = Array.from({ length: 32 }, () => "AB").join(":");

describe("buildAppleAppSiteAssociation", () => {
  it("Team ID 로 appIDs 와 /join, /g 경로를 만든다", () => {
    expect(buildAppleAppSiteAssociation("abcde12345")).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["ABCDE12345.day.whenwemeet.app"],
            components: [
              { "/": "/join/*", comment: "초대 링크" },
              { "/": "/g/*", comment: "팀 달력" },
            ],
          },
        ],
      },
    });
  });

  it("값이 없거나 형식이 틀리면 null", () => {
    expect(buildAppleAppSiteAssociation(undefined)).toBeNull();
    expect(buildAppleAppSiteAssociation("  ")).toBeNull();
    expect(buildAppleAppSiteAssociation("TOO-SHORT")).toBeNull();
  });
});

describe("buildAssetLinks", () => {
  it("쉼표 구분 지문을 정리해 넣는다 (공백, 소문자, 중복)", () => {
    expect(parseFingerprints(` ${FP1.toLowerCase()} , ${FP2},${FP1}`)).toEqual([FP1, FP2]);
    expect(buildAssetLinks(`${FP1},${FP2}`)).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "day.whenwemeet.app", sha256_cert_fingerprints: [FP1, FP2] },
      },
    ]);
  });

  it("값이 없거나 유효한 지문이 없으면 null", () => {
    expect(buildAssetLinks(undefined)).toBeNull();
    expect(buildAssetLinks("")).toBeNull();
    expect(buildAssetLinks("not-a-fingerprint, AB:CD")).toBeNull();
  });
});

describe("wellKnownResponse", () => {
  it("본문이 있으면 200 application/json, 없으면 404", async () => {
    const ok = wellKnownResponse({ a: 1 });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/json");
    expect(await ok.json()).toEqual({ a: 1 });
    expect(wellKnownResponse(null).status).toBe(404);
  });
});
