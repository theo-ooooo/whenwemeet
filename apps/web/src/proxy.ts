// Next 16 proxy (middleware 후속). 세션 쿠키로 화면 진입을 가른다 (인증흐름.md 3, #37).
// 서명 검증은 하지 않는다. JWT payload 의 exp 만 서명 없이 읽어 "만료/깨진 쿠키" 를 걸러낸다.
// 그래도 API 가 401 을 주는 경우(서명 불일치, 탈퇴 사용자)는 /auth/expired 가 쿠키를 지워 루프를 끊는다.
import { NextRequest, NextResponse } from "next/server";
import { safeNext, SESSION_COOKIE } from "@/lib/auth";
import { clearSessionCookies, EXPIRED_REASON, isSessionUsable, loginExpiredUrl } from "@/lib/session";

/** 세션 쿠키를 뺀 요청으로 화면을 그리고, 브라우저에서도 지우게 한다 */
function renderWithoutSession(req: NextRequest): NextResponse {
  const headers = new Headers(req.headers);
  const rest = req.cookies
    .getAll()
    .filter((c) => c.name !== SESSION_COOKIE)
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
  if (rest) headers.set("cookie", rest);
  else headers.delete("cookie");
  return clearSessionCookies(NextResponse.next({ request: { headers } }));
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null;

  if (pathname === "/login") {
    if (!token) return NextResponse.next();
    // 만료로 넘어온 /login 은 쿠키가 무엇이든 무조건 그린다 (왕복 차단 안전장치)
    if (req.nextUrl.searchParams.get("reason") === EXPIRED_REASON) return renderWithoutSession(req);
    // 쿠키 "존재" 가 아니라 exp 로 판단. 유효해 보이면 next 로, 만료/디코드 실패면 지우고 로그인 화면
    if (isSessionUsable(token)) {
      return NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get("next")), req.nextUrl.origin));
    }
    return renderWithoutSession(req);
  }

  // 홈(/) 은 쿠키가 없으면 app/route.ts 가 /welcome(웹) 또는 /login(앱 셸)으로 보낸다. 만료 쿠키만 여기서 정리
  if (pathname === "/") {
    if (token && !isSessionUsable(token)) {
      return clearSessionCookies(NextResponse.redirect(loginExpiredUrl(req.nextUrl.origin, "/")));
    }
    return NextResponse.next();
  }

  // 보호 라우트 (/join 은 코드 입력 화면만. /join/<code> 는 공개라 matcher 에 없다)
  if (!token) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (!isSessionUsable(token)) {
    // 쿼리(달력 ?date= 등)까지 남겨 재로그인 뒤 같은 화면으로 (#65)
    return clearSessionCookies(NextResponse.redirect(loginExpiredUrl(req.nextUrl.origin, pathname + search)));
  }
  return NextResponse.next();
}

export const config = {
  // (#311) 팀 안 화면은 /calendar, /upcoming, /free, /anniversaries, /news, /team/*, /events/*. 옛 /g/* 도 로그인 뒤 새 주소로 보내야 하니 그대로 둔다
  matcher: [
    "/",
    "/login",
    "/join",
    "/calendar",
    "/upcoming",
    "/free",
    "/anniversaries",
    "/news",
    "/team",
    "/team/:path*",
    "/events",
    "/events/:path*",
    // (#189) 약속 투표 (알림, 새 소식에서 연다)
    "/polls/:path*",
    "/g/:path*",
    "/groups/:path*",
    "/me",
    "/me/:path*",
  ],
};
