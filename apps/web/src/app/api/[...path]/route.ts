// 브라우저 → API 프록시. 쿠키의 JWT 를 Bearer 로 바꿔 전달한다 (인증흐름.md 3)
// API_MOCK=1 이면 upstream 이 메모리 목으로 응답한다.
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { errorBody } from "@/lib/envelope";
import { upstream } from "@/lib/upstream";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  const pathname = `/${path.map(encodeURIComponent).join("/")}`;

  // 초대 미리보기만 비로그인 허용. 그 외는 API 를 부르지 않고 바로 401
  const isPublic = req.method === "GET" && path[0] === "invites";
  if (!token && !isPublic) {
    return NextResponse.json(errorBody(401, "UNAUTHORIZED", "로그인이 필요해요"), { status: 401 });
  }

  // 사진 업로드(multipart) 는 바이트와 Content-Type(boundary) 을 그대로 넘긴다. 그 외 본문은 JSON 문자열
  const contentType = req.headers.get("content-type");
  const multipart = contentType?.toLowerCase().startsWith("multipart/form-data") ?? false;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = !hasBody ? null : multipart ? await req.arrayBuffer() : await req.text();
  const result = await upstream({
    method: req.method,
    path: pathname,
    search: req.nextUrl.search,
    body: body || null,
    contentType: multipart ? contentType : null,
    token,
  });

  const res = NextResponse.json(result.body ?? null, { status: result.status });
  if (result.status === 401) {
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  }
  return res;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
