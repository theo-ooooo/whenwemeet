import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { serverApi } from "@/lib/server-api";
import type { Me } from "@/lib/types";

// (#515) 관리자 화면 (D-285). 관리자만. 로그인하지 않았거나 관리자가 아니면 "찾을 수 없음" (있다는 것도 알리지 않는다).
// 실제 권한은 API(/admin/*)가 매 요청 DB 역할로 다시 확인한다. 여기는 화면을 가리는 일만
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "관리자", template: "%s | 관리자 | 언제볼까" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data } = await serverApi<Me>("/me", { from: "/admin" });
  if (!data?.isAdmin) notFound();
  return <AdminShell>{children}</AdminShell>;
}
