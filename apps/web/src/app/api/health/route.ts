// 점검 화면(/maintenance)이 서버 복구를 확인하는 창구. 인증 없이 API 의 GET /v1/health 를 그대로 전달한다 (#54).
// API 에 연결하지 못하면 upstream 이 502/504 UPSTREAM_UNAVAILABLE 을 준다. 캐치올 프록시(api/[...path]) 보다 이 라우트가 우선한다.
import { NextResponse } from "next/server";
import { upstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await upstream({ method: "GET", path: "/health", token: null });
  return NextResponse.json(result.body ?? null, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
