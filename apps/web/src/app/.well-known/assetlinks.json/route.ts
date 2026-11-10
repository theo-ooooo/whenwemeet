// Android 앱 링크 (docs/설계/앱.md 5.3). ANDROID_CERT_SHA256(쉼표 구분)이 없으면 404
import { buildAssetLinks, wellKnownResponse } from "@/lib/well-known";

export const dynamic = "force-dynamic";

export function GET() {
  return wellKnownResponse(buildAssetLinks(process.env.ANDROID_CERT_SHA256));
}
