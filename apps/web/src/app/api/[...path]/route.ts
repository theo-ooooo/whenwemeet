// 브라우저 → API 프록시. 쿠키의 JWT 를 Bearer 로 바꿔 전달한다 (인증흐름.md 3)
// API_MOCK=1 이면 upstream 이 메모리 목으로 응답한다.
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { clientIpOf } from "@/lib/email-login";
import { errorBody } from "@/lib/envelope";
import { isMock, upstream } from "@/lib/upstream";
import { CLIENT_SOURCE_HEADER, clientSourceOf } from "@/lib/assistant";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;

  // API_MOCK=1 전용: 목이 보관한 업로드 파일(프로필 사진)을 내준다. 목이 아니면 이 경로는 없다(아래 API 프록시로)
  if (isMock() && req.method === "GET" && path[0] === "__mock" && path[1] === "files" && path.length === 3) {
    const { getMockFile } = await import("@/mocks/files");
    const file = getMockFile(path[2]);
    if (!file) return NextResponse.json(errorBody(404, "NOT_FOUND", "파일이 없어요"), { status: 404 });
    return new NextResponse(Buffer.from(file.bytes), {
      headers: { "Content-Type": file.type, "Cache-Control": "private, max-age=3600" },
    });
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  const pathname = `/${path.map(encodeURIComponent).join("/")}`;

  // 초대 미리보기와 (#515) 공지 읽기(목록, 상세)만 비로그인 허용. 그 외는 API 를 부르지 않고 바로 401
  const isPublic = req.method === "GET" && (path[0] === "invites" || path[0] === "notices");
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
    // (#186) API 요청 제한이 사용자 IP 로 세도록. 키가 맞을 때만 API 가 믿는다 (api.md 1장 "요청 제한")
    internal: { clientIp: clientIpOf(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip")) },
    // (#450) AI 비서 카드에서 저장한 요청의 출처. 허용 값만 넘긴다 (AI-비서.md 6-1)
    clientSource: clientSourceOf(req.headers.get(CLIENT_SOURCE_HEADER)),
    // (#532) 앱 셸이면 UA 에 WhenwemeetApp/<버전> (ios|android). API 는 내부 키가 맞을 때만 읽고 기종과 버전만 남긴다 (D-288)
    userAgent: req.headers.get("user-agent"),
  });

  const res = NextResponse.json(result.body ?? null, { status: result.status });
  if (result.retryAfter) res.headers.set("Retry-After", result.retryAfter);
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
