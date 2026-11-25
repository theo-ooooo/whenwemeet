import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LegalPage } from "@/components/LegalPage";
import { SESSION_COOKIE } from "@/lib/auth";
import { serverApi } from "@/lib/server-api";
import type { NoticeListItem, Page } from "@/lib/types";
import { NoticesScreen } from "@/screens/NoticesScreen";

// (#515) 공지 목록. 로그인 없이 열린다 (proxy.ts matcher 에 없음, D-285). 검색 노출을 위해 sitemap 에 있다
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "공지사항",
  description: "언제볼까 업데이트 소식과 점검 안내",
};

export default async function NoticesPage() {
  const loggedIn = Boolean((await cookies()).get(SESSION_COOKIE)?.value);
  const { data } = await serverApi<Page<NoticeListItem>>("/notices?limit=20", { from: "/notices" });
  return (
    <LegalPage title="공지사항" card={false}>
      <NoticesScreen initial={data} loggedIn={loggedIn} />
    </LegalPage>
  );
}
