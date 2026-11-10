// 로그아웃: 쿠키만 지운다 (JWT 는 무상태, API 호출 없음)
import { NextRequest, NextResponse } from "next/server";
import { GROUP_COOKIE, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.nextUrl.origin), { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  res.cookies.set(GROUP_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return res;
}
