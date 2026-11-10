// iOS 유니버설 링크 (docs/설계/앱.md 5.2). 확장자 없는 정적 파일은 Content-Type 보장이 없어 route handler 로 응답한다.
// APPLE_TEAM_ID 가 없으면 404. proxy.ts matcher 에 들어 있지 않아 로그인 리다이렉트를 타지 않는다
import { buildAppleAppSiteAssociation, wellKnownResponse } from "@/lib/well-known";

export const dynamic = "force-dynamic";

export function GET() {
  return wellKnownResponse(buildAppleAppSiteAssociation(process.env.APPLE_TEAM_ID));
}
