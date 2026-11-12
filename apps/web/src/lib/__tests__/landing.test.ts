// (#307) 로그인 직후 착지 화면과 앱 링크 경로 판정
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANDING_PATH, landingPath } from "../auth";
import { opensInstalledApp } from "../well-known";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
}));
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to), useRouter: () => ({ replace: () => {} }) }));

const LandingPage = (await import("@/app/auth/landing/page")).default;
const { LandingRedirect } = await import("@/components/LandingRedirect");

/** 서명 없는 JWT 모양 (exp 만 읽는다) */
function jwt(expSec: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "7", exp: expSec })}.sig`;
}

/** React 요소 트리에서 type 이 맞는 요소를 찾는다 (서버 컴포넌트 결과를 렌더 없이 본다) */
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
  jar.clear();
  redirect.mockClear();
});

describe("opensInstalledApp: 앱 intentFilters(pathPrefix) 와 같은 판정", () => {
  it("앱이 받는 경로", () => {
    for (const p of ["/g/12/calendar", "/g/12/calendar?date=2026-11-12", "/groups/new", "/join", "/join/ABC123?auto=1", "/auth/email", "/auth/email?token=x"]) {
      expect(opensInstalledApp(p), p).toBe(true);
    }
  });
  it("앱이 받지 않는 경로", () => {
    for (const p of ["/", "/login", "/login/email/nickname", "/me", "/auth/landing", "/auth/landing?next=%2Fg%2F12%2Fcalendar", "/auth/email/link"]) {
      expect(opensInstalledApp(p), p).toBe(false);
    }
  });
  it("앱 설정(app.config.ts intentFilters)의 경로를 모두 덮는다", () => {
    const config = readFileSync(fileURLToPath(new URL("../../../../mobile/app.config.ts", import.meta.url)), "utf8");
    const entries = [...config.matchAll(/\{\s*scheme:\s*"https",\s*host:\s*WEB_HOST,\s*(pathPrefix|path):\s*"([^"]+)"\s*\}/g)];
    expect(entries.length).toBeGreaterThan(0);
    for (const [, kind, p] of entries) {
      expect(opensInstalledApp(p), p).toBe(true);
      if (kind === "pathPrefix") expect(opensInstalledApp(`${p}xyz/1`), p).toBe(true);
    }
    expect(opensInstalledApp(LANDING_PATH)).toBe(false);
  });
});

describe("landingPath", () => {
  it("next 를 쿼리로 싣고, / 면 붙이지 않는다", () => {
    expect(landingPath("/g/12/calendar")).toBe("/auth/landing?next=%2Fg%2F12%2Fcalendar");
    expect(landingPath("/join/AB?auto=1&by=3")).toBe("/auth/landing?next=%2Fjoin%2FAB%3Fauto%3D1%26by%3D3");
    expect(landingPath("/")).toBe("/auth/landing");
    expect(landingPath(null)).toBe("/auth/landing");
  });
  it("바깥 주소는 버린다 (safeNext)", () => {
    expect(landingPath("https://evil.com")).toBe("/auth/landing");
    expect(landingPath("//evil.com")).toBe("/auth/landing");
  });
});

describe("/auth/landing 화면", () => {
  it("세션이 있으면 next 로 클라이언트 이동하는 LandingRedirect 를 그린다 (서버 리다이렉트 없음)", async () => {
    jar.set("wwm_session", jwt(Date.now() / 1000 + 3600));
    const el = await LandingPage({ searchParams: Promise.resolve({ next: "/g/12/calendar" }) });
    expect(redirect).not.toHaveBeenCalled();
    expect(find(el, LandingRedirect)?.props.next).toBe("/g/12/calendar");
  });
  it("next 가 바깥 주소면 / 로", async () => {
    jar.set("wwm_session", jwt(Date.now() / 1000 + 3600));
    const el = await LandingPage({ searchParams: Promise.resolve({ next: "https://evil.com" }) });
    expect(find(el, LandingRedirect)?.props.next).toBe("/");
  });
  it("세션이 없거나 만료면 로그인 화면으로 (next 유지)", async () => {
    await expect(LandingPage({ searchParams: Promise.resolve({ next: "/g/12/calendar" }) })).rejects.toThrow(
      "REDIRECT /login?next=%2Fg%2F12%2Fcalendar",
    );
    jar.set("wwm_session", jwt(Date.now() / 1000 - 10));
    await expect(LandingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /login");
  });
});
