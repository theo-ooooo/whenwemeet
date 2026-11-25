"use client";
// (#538) 중요 공지 팝업 (D-291). 팀 화면 뼈대(AppShell)에 하나. 관리자가 "팝업으로 띄우기" 를 고른 공지 중 내가 닫지 않은 가장 최근 것을 한 번 띄운다.
// 폰은 아래에서 올라오는 시트, 넓은 화면(lg)은 가운데 창 (알림 안내 PushPrompt 와 같은 모양).
// [자세히 보기] 는 닫기와 같이 기록하고 상세로, [닫기] 와 Esc 도 기록한다(다시 띄우지 않음, 기기가 바뀌어도). 바깥 누름은 닫지 않는다(실수로 영영 닫히지 않게).
// 첫 화면이 그려진 뒤 잠깐 두고 띄우고, 알림 안내나 다른 막는 창(이용 제한 팀, 꼭 업데이트)이 열려 있으면 기다린다
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useDismissNotice, useNoticeAttention } from "@/hooks";
import { dismissHint } from "@/lib/hint";
import { noticeBannerKey, noticeHref } from "@/lib/notice";
import { isPromptOpen, subscribePrompt } from "@/lib/push";
import { NoticeKindBadge } from "./NoticeKindBadge";
import { Button } from "./ui";
import { useEscape } from "./ui/useEscape";

/** 첫 화면 뒤 기다리는 시간. 알림 안내(800ms)가 먼저 열리면 그쪽이 닫힐 때까지 기다린다 */
const SHOW_DELAY_MS = 1200;

export function NoticePopup({ blocked }: { blocked: boolean }) {
  const router = useRouter();
  const q = useNoticeAttention();
  const { mutate: dismiss } = useDismissNotice();
  const pushOpen = useSyncExternalStore(subscribePrompt, isPromptOpen, () => false);
  const [ready, setReady] = useState(false);
  const [closedId, setClosedId] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  const popup = q.data?.popup ?? null;
  const open = ready && popup !== null && popup.id !== closedId && !blocked && !pushOpen;

  function close(): number | null {
    if (!popup) return null;
    setClosedId(popup.id);
    // 같은 공지의 달력 위 띠도 감춘다 (이미 봤으므로)
    dismissHint(noticeBannerKey(popup.id));
    void dismiss(popup.id);
    return popup.id;
  }

  useEscape(open, () => void close());
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  if (!open || !popup) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center">
      <div aria-hidden="true" className="anim-fade absolute inset-0 bg-[var(--scrim)]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative w-full fold:max-w-[480px] rounded-t-2xl bg-paper px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2 outline-none lg:max-w-[420px] lg:rounded-2xl lg:border lg:border-line lg:pb-5 lg:pt-6 lg:shadow-[var(--pop-shadow)]"
      >
        <div aria-hidden="true" className="mx-auto mb-5 h-1 w-9 rounded-full bg-[var(--grab)] lg:hidden" />
        <NoticeKindBadge kind={popup.kind} />
        <h2 id={titleId} className="mt-2.5 break-keep text-[20px] font-bold leading-7 tracking-[-0.02em]">
          {popup.title}
        </h2>
        {popup.preview && <p className="mt-2 line-clamp-6 whitespace-pre-line break-words text-[15px] leading-6 text-soft">{popup.preview}</p>}
        <div className="mt-6 flex flex-col gap-1.5">
          <Button
            size="lg"
            full
            onClick={() => {
              const id = close();
              if (id !== null) router.push(noticeHref(id, "popup"));
            }}
          >
            자세히 보기
          </Button>
          <button type="button" onClick={() => void close()} className="h-11 rounded-md text-[15px] font-semibold text-ink-2 hover:bg-hover">
            닫기
          </button>
        </div>
        <p className="mt-1 text-center text-[12px] leading-4 text-ink-2">닫으면 다시 띄우지 않아요. 내 정보 &gt; 공지사항에서 볼 수 있어요</p>
      </div>
    </div>
  );
}
