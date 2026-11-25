"use client";
// (#538) 공지 상세를 열면 그 공지의 달력 위 새 공지 띠를 이 기기에서 감춘다 (D-291, "공지를 읽으면 사라짐"). 그리는 것은 없다
import { useEffect } from "react";
import { dismissHint } from "@/lib/hint";
import { noticeBannerKey } from "@/lib/notice";

export function NoticeReadMark({ id }: { id: number }) {
  useEffect(() => dismissHint(noticeBannerKey(id)), [id]);
  return null;
}
