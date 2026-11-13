// (#203) 오프라인 안내 (D-256). 서비스 워커가 install 때 캐시한다. 정적 화면이라 쿠키를 읽지 않고 사용자 데이터가 없다
// (proxy.ts matcher 밖, 인증 불필요)
import type { Metadata } from "next";
import { OfflineScreen } from "@/components/OfflineScreen";

export const metadata: Metadata = { title: "오프라인", robots: { index: false, follow: false } };
export const dynamic = "force-static";

export default function OfflinePage() {
  return <OfflineScreen />;
}
