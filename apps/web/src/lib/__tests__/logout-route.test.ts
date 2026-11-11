import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const upstream = vi.fn();
vi.mock("@/lib/upstream", () => ({ upstream: (...a: unknown[]) => upstream(...a) }));

const { POST } = await import("@/app/auth/logout/route");

function req(form: Record<string, string> | null, session: string | null = "jwt.abc.def") {
  const headers = new Headers();
  if (session) headers.set("cookie", `wwm_session=${session}`);
  let body: string | undefined;
  if (form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(form).toString();
  }
  return new NextRequest("https://whenwemeet.day/auth/logout", { method: "POST", headers, body });
}

describe("/auth/logout 기기 해제 (#188 D-83)", () => {
  afterEach(() => upstream.mockReset());

  it("토큰이 있으면 쿠키를 지우기 전에 그 세션으로 DELETE /me/push-devices (2초)", async () => {
    upstream.mockResolvedValue({ status: 200, body: {} });
    const res = await POST(req({ pushToken: "ExponentPushToken[abc]" }));
    expect(upstream).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/me/push-devices",
      body: JSON.stringify({ token: "ExponentPushToken[abc]" }),
      token: "jwt.abc.def",
      timeoutMs: 2000,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://whenwemeet.day/login");
    expect(res.cookies.get("wwm_session")?.value).toBe("");
  });

  it("해제가 실패해도 로그아웃은 진행한다", async () => {
    upstream.mockRejectedValue(new Error("down"));
    const res = await POST(req({ pushToken: "ExponentPushToken[abc]" }));
    expect(res.status).toBe(303);
    expect(res.cookies.get("wwm_session")?.value).toBe("");
  });

  it("토큰이 없거나 형식이 틀리거나 세션이 없으면 API 를 부르지 않는다", async () => {
    await POST(req({ pushToken: "" }));
    await POST(req({ pushToken: "not-a-token" }));
    await POST(req(null));
    await POST(req({ pushToken: "ExponentPushToken[abc]" }, null));
    expect(upstream).not.toHaveBeenCalled();
  });
});
