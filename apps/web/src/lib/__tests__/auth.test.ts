import { describe, expect, it } from "vitest";
import { isHandoffPair } from "../auth";

const H = "A".repeat(43);
const V = "b".repeat(43);

describe("isHandoffPair", () => {
  it("handoff 43자 base64url, verifier 43 ~ 128자만 통과", () => {
    expect(isHandoffPair(H, V)).toBe(true);
    expect(isHandoffPair("a_-".repeat(14) + "z", "x.~_-".repeat(25) + "abc")).toBe(true);
  });

  it("없음, 길이, 허용 밖 글자는 거른다", () => {
    expect(isHandoffPair(null, V)).toBe(false);
    expect(isHandoffPair(H, null)).toBe(false);
    expect(isHandoffPair(H.slice(1), V)).toBe(false);
    expect(isHandoffPair(H, V.slice(1))).toBe(false);
    expect(isHandoffPair(H, "b".repeat(129))).toBe(false);
    expect(isHandoffPair(`${H.slice(1)}=`, V)).toBe(false);
    expect(isHandoffPair(H, `${V.slice(1)}/`)).toBe(false);
  });
});
