import { createHash, randomBytes as nodeRandom } from "node:crypto";
import { appleNickname, base64url, codeChallenge, createAppleNonce, createVerifier, hex } from "../pkce";

const sha256 = async (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
const rnd = (n: number) => new Uint8Array(nodeRandom(n));

describe("base64url", () => {
  it("Buffer 의 base64url 과 같다 (길이 0~40)", () => {
    for (let n = 0; n <= 40; n++) {
      const b = rnd(n);
      expect(base64url(b)).toBe(Buffer.from(b).toString("base64url"));
    }
  });
});

describe("verifier / challenge", () => {
  it("RFC 7636 부록 B 예시", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", sha256)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("verifier 는 32바이트 → 43자 base64url, 매번 다르다", () => {
    const a = createVerifier(rnd);
    const b = createVerifier(rnd);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it("challenge 는 43자이고 API 와 같은 계산(base64url(sha256))", async () => {
    const v = createVerifier(rnd);
    const c = await codeChallenge(v, sha256);
    expect(c).toHaveLength(43);
    expect(c).toBe(createHash("sha256").update(v).digest("base64url"));
  });
  it("형식이 틀린 verifier 는 거절", async () => {
    await expect(codeChallenge("short", sha256)).rejects.toThrow();
    await expect(codeChallenge("a".repeat(42) + "=", sha256)).rejects.toThrow();
  });
});

describe("createAppleNonce", () => {
  it("raw 는 64자 hex(설계 32~128), hashed 는 sha256hex(raw)", async () => {
    const n = await createAppleNonce(rnd, sha256);
    expect(n.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(n.hashed).toBe(createHash("sha256").update(n.raw).digest("hex"));
    expect(hex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });
});

describe("appleNickname", () => {
  it.each([
    [null, undefined],
    [{}, undefined],
    [{ familyName: " ", givenName: "" }, undefined],
    [{ familyName: "홍", givenName: "길동" }, "홍길동"],
    [{ familyName: "Kim", givenName: "Theo" }, "Kim Theo"],
    [{ givenName: "Theo" }, "Theo"],
    [{ familyName: "A".repeat(15), givenName: "B".repeat(15) }, `${"A".repeat(15)} BBBB`],
  ])("%p → %p", (name, out) => expect(appleNickname(name as never)).toBe(out));
});
