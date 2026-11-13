import type { Metadata } from "next";
import { SearchScreen } from "@/screens/SearchScreen";

export const metadata: Metadata = { title: "일정 검색" };

/** (#199) 일정 검색 `/search?q=&scope=all`. 팀은 쿠키(지금 보는 팀), 모든 팀은 scope=all */
export default function SearchPage() {
  return <SearchScreen />;
}
