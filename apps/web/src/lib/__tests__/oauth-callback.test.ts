// (#310) 웹 카카오, 웹 애플 로그인 콜백(/auth/callback) 뒤 이동. #307 과 같이 세션을 만든 리다이렉트가
// 앱 링크 경로(/g/.., /join/..)로 끝나면 Android 브라우저가 설치된 앱(세션 없음)으로 넘긴다. 착지 화면으로 가야 한다
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const upstream = vi.fn();
let mock = false;
vi.mock("@/lib/upstream", () => ({
  upstream: (...a: unknown[]) => upstream(...a),
  isMock: () => mock,
  apiUrl: () => "https://api.whenwemeet.day",
}));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  useRouter: () => ({ replace: () => {} }),
}));

const callback = (await import("@/app/auth/callback/route")).GET;
const kakaoStart = (await import("@/app/auth/kakao/route")).GET;
const appleStart = (await import("@/app/auth/apple/route")).GET;
const appLogin = (await import("@/app/auth/app/route")).GET;
const LandingPage = (await import("@/app/auth/landing/page")).default;
const { LandingRedirect } = await import("@/components/LandingRedirect");
const { opensInstalledApp } = await import("@/lib/well-known");

const ORIGIN = "https://whenwemeet.day";
/** exp 가 미래인 JWT 모양 (서명 검사 없음) */
function jwt(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "7", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}
/** API(auth.controller kakaoCallback, apple-auth.service completeWeb)가 만드는 웹 콜백 주소와 같은 모양 */
const callbackReq = (token: string, next: string | null) => {
  const q = new URLSearchParams({ token });
  if (next !== null) q.set("next", next);
  return new NextRequest(`${ORIGIN}/auth/callback?${q.toString()}`);
};
const locOf = (res: Response) => new URL(res.headers.get("location") ?? "", ORIGIN);

/** React 요소 트리에서 type 이 맞는 요소 (landing.test.ts 와 같은 방식) */
function find(node: unknown, type: unknown): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, type);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) return el as { props: Record<string, unknown> };
  return find(el.props?.children, type);
}

afterEach(() => {
  mock = false;
  jar.clear();
  upstream.mockReset();
  vi.unstubAllEnvs();
});

const NEXTS = ["/", "/g/12/calendar", "/g/12/calendar?date=2026-11-12", "/groups/new", "/join/ABC123?auto=1&by=3", "/me"];

describe("/auth/callback: 세션을 실은 302 는 앱 링크 경로로 가지 않는다 (#310)", () => {
  it.each(NEXTS)("next=%s → 착지 화면 + next 유지 + 세션 쿠키", async (next) => {
    const token = jwt();
    const res = await callback(callbackReq(token, next));
    expect(res.status).toBe(302);
    const loc = locOf(res);
    expect(loc.origin).toBe(ORIGIN);
    expect(opensInstalledApp(loc.pathname + loc.search)).toBe(false);
    expect(loc.pathname).toBe("/auth/landing");
    expect(loc.searchParams.get("next") ?? "/").toBe(next);
    expect(res.cookies.get("wwm_session")?.value).toBe(token);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("next 가 없거나 바깥 주소면 next 없는 착지 화면", async () => {
    for (const next of [null, "https://evil.com", "//evil.com/g/1"]) {
      expect(locOf(await callback(callbackReq(jwt(), next))).toString()).toBe(`${ORIGIN}/auth/landing`);
    }
  });

  it("옛 _q_ 꼬리(#65)는 떼고 경로만 착지 화면 next 로", async () => {
    const loc = locOf(await callback(callbackReq(jwt(), "/join/ABC123/_q_/YXV0bz0x")));
    expect(loc.pathname).toBe("/auth/landing");
    expect(loc.searchParams.get("next")).toBe("/join/ABC123");
  });

  it("토큰이 JWT 모양이 아니면 세션 없이 /login?error=OAUTH_STATE (그대로)", async () => {
    const res = await callback(callbackReq("nope", "/g/1/calendar"));
    expect(locOf(res).toString()).toBe(`${ORIGIN}/login?error=OAUTH_STATE`);
    expect(res.cookies.get("wwm_session")).toBeUndefined();
  });
});

describe("로그인 버튼 → 콜백 → 착지 화면 → next 체인 (목 모드, 카카오/애플 대신 콜백으로 바로)", () => {
  it.each([
    ["kakao", kakaoStart],
    ["apple", appleStart],
  ] as const)("%s: 문서 이동은 앱 링크 경로에 닿지 않고, 착지 화면이 next 로 클라이언트 이동한다", async (_, start) => {
    mock = true;
    vi.stubEnv("API_MOCK", "1");
    const next = "/join/ABC123?auto=1";
    const hops: string[] = [];

    // 1) 버튼 → /auth/kakao | /auth/apple → 302 /auth/callback
    const r1 = await start(new NextRequest(`${ORIGIN}/auth/x?next=${encodeURIComponent(next)}`));
    const l1 = locOf(r1);
    hops.push(l1.pathname + l1.search);
    expect(l1.pathname).toBe("/auth/callback");

    // 2) /auth/callback → 302 착지 화면 + 쿠키
    const r2 = await callback(new NextRequest(l1));
    const l2 = locOf(r2);
    hops.push(l2.pathname + l2.search);
    const session = r2.cookies.get("wwm_session")?.value;
    expect(session).toBe("mock.me.sig");

    for (const h of hops) expect(opensInstalledApp(h), h).toBe(false);

    // 3) 착지 화면(쿠키 있음): 서버 리다이렉트 없이 LandingRedirect(next) 를 그린다 = 클라이언트 이동
    jar.set("wwm_session", session ?? "");
    const el = await LandingPage({ searchParams: Promise.resolve({ next: l2.searchParams.get("next") ?? undefined }) });
    expect(find(el, LandingRedirect)?.props.next).toBe(next);
  });

  it("실모드 시작은 API 로 302 (next 그대로)", async () => {
    const l = locOf(await kakaoStart(new NextRequest(`${ORIGIN}/auth/kakao?next=%2Fg%2F3`)));
    expect(l.toString()).toBe("https://api.whenwemeet.day/v1/auth/kakao?next=%2Fg%2F3");
    const a = locOf(await appleStart(new NextRequest(`${ORIGIN}/auth/apple?next=%2Fg%2F3`)));
    expect(a.toString()).toBe("https://api.whenwemeet.day/v1/auth/apple?next=%2Fg%2F3");
  });
});

describe("/auth/app (앱 웹뷰 안 handoff) 는 바꾸지 않는다", () => {
  it("성공이면 next 로 바로 302 (앱 안이라 앱으로 넘길 일이 없다)", async () => {
    const token = jwt();
    upstream.mockResolvedValue({ status: 200, body: { status: 200, data: { token }, message: "OK" } });
    const q = new URLSearchParams({ h: "A".repeat(43), v: "B".repeat(43), next: "/g/12/calendar" });
    const res = await appLogin(new NextRequest(`${ORIGIN}/auth/app?${q.toString()}`));
    expect(res.status).toBe(302);
    expect(locOf(res).toString()).toBe(`${ORIGIN}/g/12/calendar`);
    expect(res.cookies.get("wwm_session")?.value).toBe(token);
  });
});
