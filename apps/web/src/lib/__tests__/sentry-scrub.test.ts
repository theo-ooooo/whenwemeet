import { describe, expect, it } from "vitest";
import { FILTERED, redactText, scrubBreadcrumb, scrubEvent, scrubQuery, scrubUrl } from "@/lib/sentry-scrub";

describe("redactText", () => {
  it("이메일, Bearer 토큰, JWT, token= 꼴 값, 초대코드 경로를 지운다", () => {
    expect(redactText("user kim.a+1@example.co.kr not found")).toBe(`user ${FILTERED} not found`);
    expect(redactText("Authorization: Bearer abc.def-123")).toBe(`Authorization: Bearer ${FILTERED}`);
    // 진짜 토큰처럼 보이는 상수가 비밀 탐지에 걸리지 않도록 조각을 이어 만든다
    const jwtLike = ["eyJhbGciOiJub25lIn0", "eyJ4IjoxfQ", "x-1"].join(".");
    expect(redactText(`jwt ${jwtLike} 끝`)).toBe(`jwt ${FILTERED} 끝`);
    expect(redactText("failed: /auth/email?token=abc123&x=1")).toBe(`failed: /auth/email?token=${FILTERED}&x=1`);
    expect(redactText("GET /v1/invites/AB12CD 404")).toBe(`GET /v1/invites/${FILTERED} 404`);
    // (#274) 일정 링크 토큰
    expect(redactText("GET /v1/event-shares/Ab3_-Ab3_-Ab3_-Ab3_-AB/join 404")).toBe(`GET /v1/event-shares/${FILTERED}/join 404`);
    expect(redactText("/join/e/Ab3_-Ab3_-Ab3_-Ab3_-AB?auto=1")).toBe(`/join/e/${FILTERED}?auto=1`);
    expect(redactText("/og/join/e/Ab3_-Ab3_-Ab3_-Ab3_-AB")).toBe(`/og/join/e/${FILTERED}`);
    expect(redactText("보통 문장 그대로")).toBe("보통 문장 그대로");
  });
});

describe("scrubQuery / scrubUrl", () => {
  it("민감한 키의 값만 지우고 키와 나머지는 남긴다", () => {
    expect(scrubQuery("?token=t1&code=123456&email=a%40b.com&state=s&groupId=7")).toBe(
      `?token=${FILTERED}&code=${FILTERED}&email=${FILTERED}&state=${FILTERED}&groupId=7`,
    );
    expect(scrubQuery("handoffCode=x&next=%2Fg%2F1")).toBe(`handoffCode=${FILTERED}&next=%2Fg%2F1`);
    expect(scrubQuery("")).toBe("");
  });

  it("URL 의 쿼리, 초대코드 경로를 지우고 해시는 버린다", () => {
    expect(scrubUrl("https://api.whenwemeet.day/v1/auth/kakao/callback?code=c&state=s")).toBe(
      `https://api.whenwemeet.day/v1/auth/kakao/callback?code=${FILTERED}&state=${FILTERED}`,
    );
    expect(scrubUrl("/join/AB12CD?from=share#top")).toBe(`/join/${FILTERED}?from=share`);
    expect(scrubUrl("/g/3/calendar")).toBe("/g/3/calendar");
  });
});

describe("scrubEvent", () => {
  it("요청의 쿠키, 본문, 접속 환경을 버리고 헤더는 허용 목록만 남긴다", () => {
    const out = scrubEvent({
      request: {
        url: "https://api.whenwemeet.day/v1/auth/email/verify?token=t",
        method: "POST",
        query_string: "token=t&a=1",
        cookies: { wwm_session: "s" },
        data: { email: "a@b.com", code: "123456" },
        env: { REMOTE_ADDR: "203.0.113.1" },
        headers: {
          Authorization: "Bearer x",
          cookie: "wwm_session=s",
          "x-internal-key": "k",
          "x-client-ip": "203.0.113.7",
          "x-forwarded-for": "203.0.113.7",
          "user-agent": "Mozilla/5.0",
          "content-type": "application/json",
        },
      },
    });
    expect(out.request).toEqual({
      url: `https://api.whenwemeet.day/v1/auth/email/verify?token=${FILTERED}`,
      method: "POST",
      query_string: `token=${FILTERED}&a=1`,
      headers: { "user-agent": "Mozilla/5.0", "content-type": "application/json" },
    });
  });

  it("사용자는 id 만, 이메일과 IP 는 버린다. id 가 없으면 user 자체를 뺀다", () => {
    expect(scrubEvent({ user: { id: "u1", email: "a@b.com", ip_address: "1.2.3.4", username: "kim" } }).user).toEqual({ id: "u1" });
    expect(scrubEvent({ user: { ip_address: "1.2.3.4" } })).not.toHaveProperty("user");
  });

  it("메시지, 예외 값, 로그 항목, extra, contexts 안의 이메일과 토큰을 지운다", () => {
    const out = scrubEvent({
      message: "mail to a@b.com",
      logentry: { message: "x a@b.com", formatted: "y a@b.com", params: ["c@d.com"] },
      exception: { values: [{ type: "Error", value: "no user a@b.com token=zz" }, { type: "Error" }] },
      extra: { password: "p", nested: { note: "e@f.com", count: 3 }, code: "P2002" },
      contexts: { response: { status_code: 500 } },
    });
    expect(out.message).toBe(`mail to ${FILTERED}`);
    expect(out.logentry).toEqual({ message: `x ${FILTERED}`, formatted: `y ${FILTERED}`, params: [FILTERED] });
    expect(out.exception?.values?.[0].value).toBe(`no user ${FILTERED} token=${FILTERED}`);
    expect(out.exception?.values?.[1]).toEqual({ type: "Error" });
    expect(out.extra).toEqual({ password: FILTERED, nested: { note: FILTERED, count: 3 }, code: "P2002" });
    expect(out.contexts).toEqual({ response: { status_code: 500 } });
  });

  it("너무 깊은 값은 버린다", () => {
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 8; i++) deep = { d: deep };
    const out = scrubEvent({ extra: deep });
    expect(JSON.stringify(out.extra)).toContain(FILTERED);
    expect(JSON.stringify(out.extra)).not.toContain("leaf");
  });

  it("원본 이벤트는 바꾸지 않는다", () => {
    const event = { message: "a@b.com", request: { cookies: { s: "1" } } };
    scrubEvent(event);
    expect(event).toEqual({ message: "a@b.com", request: { cookies: { s: "1" } } });
  });
});

describe("scrubBreadcrumb", () => {
  it("fetch, 이동 브레드크럼의 URL 쿼리를 지우고 콘솔 인자는 버린다", () => {
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "/api/auth/email/verify?token=t", method: "POST", status_code: 500 } })).toEqual({
      category: "fetch",
      data: { url: `/api/auth/email/verify?token=${FILTERED}`, method: "POST", status_code: 500 },
    });
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/join/AB12CD", to: "/auth/callback?code=c" } }).data).toEqual({
      from: `/join/${FILTERED}`,
      to: `/auth/callback?code=${FILTERED}`,
    });
    expect(scrubBreadcrumb({ category: "console", message: "login a@b.com", data: { arguments: ["a@b.com"], logger: "console" } })).toEqual({
      category: "console",
      message: `login ${FILTERED}`,
      data: { logger: "console" },
    });
    expect(scrubBreadcrumb({ category: "ui.click", message: "button" })).toEqual({ category: "ui.click", message: "button" });
  });
});

describe("(#450) AI 비서 글", () => {
  it("text, history, historyText, reply 키는 모양과 상관없이 통째로 지운다", () => {
    const event = scrubEvent({
      extra: {
        body: { text: "하늘이랑 강남 회식", history: [{ role: "user", text: "내일" }] },
        reply: "이렇게 넣을까요?",
        historyText: "[일정 초안] 회식",
        code: "X",
      },
    });
    expect(event.extra).toEqual({ body: { text: FILTERED, history: FILTERED }, reply: FILTERED, historyText: FILTERED, code: "X" });
  });
});
