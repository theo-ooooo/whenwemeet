"use client";
// (#188, #291) 알림 권한 안내 (푸시-알림.md 8-1, 기획 3-5). 루트 레이아웃에 하나만 둔다.
// 앱을 열 때, 일정을 저장한 뒤, 알림 값을 처음 고를 때 maybeOpenPushPrompt 가 연다. 열림 상태는 lib/push 의 모듈 상태.
// [알림 받기] 를 누를 때만 OS 권한 창을 띄운다. [나중에], 바깥 눌러 닫기는 7일 뒤 다시 묻는다 (PROMPT_LATER_MS)
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { requestPushStatus } from "@/lib/app-bridge";
import { isPromptOpen, recordPrompt, setPromptOpen, subscribePrompt } from "@/lib/push";
import { usePushRegistrar } from "@/lib/usePushSync";
import { IconBell, IconClock, IconHeart, IconTeam } from "./icons";
import { Button } from "./ui";

const ITEMS = [
  { icon: IconClock, title: "일정 시작 전에", body: "일정마다 고른 시각에 알려 드려요" },
  { icon: IconTeam, title: "팀원이 일정을 바꾸면", body: "추가, 수정, 삭제를 모아서 알려 드려요" },
  { icon: IconHeart, title: "기념일 아침에", body: "100일, 생일 같은 날을 놓치지 않게요" },
] as const;

export function PushPrompt() {
  const open = useSyncExternalStore(subscribePrompt, isPromptOpen, () => false);
  const apply = usePushRegistrar();
  const [asking, setAsking] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") later();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // later 는 asking 만 읽으므로 열림이 바뀔 때만 다시 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asking]);

  function later() {
    if (asking) return;
    recordPrompt("later");
    setPromptOpen(false);
  }

  async function accept() {
    recordPrompt("accepted");
    setAsking(true);
    const status = await requestPushStatus("request");
    // 허용이면 등록, 거부면 아무 안내 없이 닫는다 (8-1)
    await apply(status);
    setAsking(false);
    setPromptOpen(false);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center">
      <button type="button" aria-label="나중에" onClick={later} tabIndex={-1} className="anim-fade absolute inset-0 bg-[var(--scrim)]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative w-full fold:max-w-[480px] rounded-t-2xl bg-paper px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2 outline-none lg:max-w-[400px] lg:rounded-2xl lg:border lg:border-line lg:pb-5 lg:pt-6 lg:shadow-[var(--pop-shadow)]"
      >
        <div aria-hidden="true" className="mx-auto mb-5 h-1 w-9 rounded-full bg-[var(--grab)] lg:hidden" />

        <span
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-2xl text-acc-ink"
          style={{ background: "color-mix(in srgb, var(--pri) 12%, transparent)" }}
        >
          <IconBell size={28} />
        </span>

        <h2 id={titleId} className="mt-4 text-[20px] font-bold leading-[28px] tracking-[-0.02em]">
          약속을 놓치지 않게
          <br />
          알림을 켜 둘까요?
        </h2>
        <p className="t-sub mt-1.5">같이 쓰는 달력에 생기는 일을 휴대폰으로 알려 드려요</p>

        <ul className="mt-5 flex flex-col gap-3.5">
          {ITEMS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex items-center gap-3">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-hover text-ink">
                <Icon size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold leading-5">{title}</span>
                <span className="block text-[13px] leading-[18px] text-ink-2">{body}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-1.5">
          <Button size="lg" full loading={asking} onClick={() => void accept()}>
            알림 받기
          </Button>
          <button
            type="button"
            onClick={later}
            disabled={asking}
            className="h-11 rounded-md text-[15px] font-semibold text-ink-2 hover:bg-hover disabled:opacity-50"
          >
            나중에
          </button>
        </div>
        <p className="mt-1 text-center text-[12px] leading-4 text-ink-2">내 정보 &gt; 알림에서 언제든 바꿀 수 있어요</p>
      </div>
    </div>
  );
}
