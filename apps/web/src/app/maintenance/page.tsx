// 점검 중 화면 (#54). 인증 불필요(proxy.ts matcher 밖), API 를 부르지 않는다. [다시 시도] 와 자동 복귀는 ?from 으로
import type { Metadata } from "next";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { safeFrom } from "@/lib/maintenance";

export const metadata: Metadata = { title: "점검 중", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  return <MaintenanceScreen from={safeFrom(from)} />;
}
