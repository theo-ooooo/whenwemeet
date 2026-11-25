"use client";
// (#538) 공지 상세를 열면 그 공지의 달력 위 새 공지 띠를 이 기기에서 감춘다 (D-291, "공지를 읽으면 사라짐").
// (#544) 로그인했으면 읽음을 기록한다(처음 한 번만, 처음 연 경로 via, D-293). 경로를 알린 `?from=` 은 기록을 보낸 뒤 주소에서 지운다
//   (공유하거나 새로 고쳐도 같은 경로로 다시 남지 않게. 서버 렌더를 다시 하지 않도록 history.replaceState). 그리는 것은 없다
import { useEffect, useRef } from "react";
import { useMarkNoticeRead } from "@/hooks";
import { dismissHint } from "@/lib/hint";
import { noticeBannerKey } from "@/lib/notice";
import type { NoticeReadVia } from "@/lib/types";

export function NoticeReadMark({ id, via, loggedIn, stripFrom }: { id: number; via: NoticeReadVia; loggedIn: boolean; stripFrom: boolean }) {
  const { mutate: markRead } = useMarkNoticeRead();
  const done = useRef<number | null>(null);
  useEffect(() => {
    dismissHint(noticeBannerKey(id));
    if (done.current === id) return;
    done.current = id;
    if (loggedIn) void markRead({ id, via });
    if (stripFrom) window.history.replaceState(null, "", window.location.pathname);
  }, [id, via, loggedIn, stripFrom, markRead]);
  return null;
}
