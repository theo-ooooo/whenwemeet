"use client";
// (#274) 일정 카드 공유 시트 (D-186). 일정 상세 제목줄의 [공유] 로 연다.
// 열면 그 일정(반복이면 회차)의 살아 있는 링크를 받고(없으면 서버가 만든다), 카카오톡 카드(#195 와 같은 경로), 링크 복사,
// OS 공유 시트(앱 셸은 share 브리지), 링크 끊기를 둔다. 끊으면 다음 [공유] 에서 새 링크
import { useState, useSyncExternalStore } from "react";
import { useGroupContext } from "./AppShell";
import { KakaoSymbol } from "./icons";
import { useToast } from "./Toast";
import { Button, ConfirmDialog, ErrorState, Sheet, Skeleton } from "./ui";
import { messageOf, useCreateEventShare, useRevokeEventShare, type ApiFailure } from "@/hooks";
import { isInApp, postToApp } from "@/lib/app-bridge";
import { eventShareExpiryLabel, eventShareKakaoFeed, eventShareText, eventShareTimeLabel } from "@/lib/event-share";
import { preloadKakaoSdk, shareKakaoFeed } from "@/lib/kakao-share";
import type { Event, EventShareLink } from "@/lib/types";

const noopSubscribe = () => () => {};
/** OS 공유 시트를 띄울 수 있는지 (팀 설정 초대 칸과 같은 판정) */
const canUseOsShare = () => isInApp() || typeof navigator.share === "function";
const textButton = "hit rounded-sm px-1 py-2 text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink";

/**
 * 일정 상세가 쓰는 공유 시트 묶음. open() 은 [공유] 누름(사용자 동작) 안에서 링크를 받는다.
 * 카카오 SDK 도 이때 미리 받는다 (PC 공유 창이 팝업 차단에 걸리지 않게, D-168)
 */
export function useEventShareSheet(groupId: number, ev: Event) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<EventShareLink | null>(null);
  const { mutate: create, error } = useCreateEventShare(groupId);
  const target = { eventId: ev.id, occurrence: ev.repeat ? ev.occurrence : null };

  async function load() {
    setLink(null);
    const r = await create(target);
    if (r.ok) setLink(r.data);
  }

  function start() {
    preloadKakaoSdk();
    setOpen(true);
    void load();
  }

  const sheet = open ? (
    <EventShareSheet groupId={groupId} event={ev} target={target} link={link} error={error} onRetry={load} onClose={() => setOpen(false)} />
  ) : null;
  return { open: start, sheet };
}

function EventShareSheet({
  groupId,
  event: ev,
  target,
  link,
  error: createError,
  onRetry,
  onClose,
}: {
  groupId: number;
  event: Event;
  target: { eventId: number; occurrence: string | null };
  link: EventShareLink | null;
  error: ApiFailure | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const { group } = useGroupContext();
  const { mutate: revoke, isPending: revoking } = useRevokeEventShare(groupId);
  const [confirm, setConfirm] = useState(false);
  const [kakaoBusy, setKakaoBusy] = useState(false);
  const canOsShare = useSyncExternalStore(noopSubscribe, canUseOsShare, () => false);

  const text = link ? eventShareText(link, ev) : null;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.show("일정 링크를 복사했어요");
    } catch {
      toast.show("복사하지 못했어요. 다시 시도해 주세요");
    }
  }

  async function share() {
    if (!link || !text) return;
    // 앱 안이면 OS 공유 시트 (링크는 셸이 붙인다), 브라우저는 Web Share, 둘 다 없으면 복사
    if (postToApp({ type: "share", url: link.url, text: text.message, title: text.title })) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: text.title, text: text.text, url: link.url });
      } catch {}
      return;
    }
    await copy();
  }

  // 카카오톡 카드. 키 없음, SDK 실패, 카카오 공유를 모르는 옛 앱이면 OS 공유 시트, 복사로 (D-168, D-169)
  async function shareKakao() {
    if (!link || !text) return;
    const feed = eventShareKakaoFeed(link, ev, group?.name ?? "");
    setKakaoBusy(true);
    try {
      if (feed && (await shareKakaoFeed(feed, text.message))) return;
      await share();
    } finally {
      setKakaoBusy(false);
    }
  }

  async function cut() {
    const r = await revoke(target);
    if (!r.ok) {
      toast.show(messageOf(r.error, "링크를 끊지 못했어요. 다시 시도해 주세요"));
      return;
    }
    setConfirm(false);
    onClose();
    toast.show("링크를 끊었어요. 다시 공유하면 새 링크가 만들어져요");
  }

  return (
    <>
      <Sheet open={!confirm} onClose={onClose} title="일정 공유">
        <p className="truncate text-[15px] font-semibold leading-[22px]">{ev.title}</p>
        <p className="text-[13px] leading-5 text-soft">{eventShareTimeLabel(ev)}</p>
        {link ? (
          <>
            <p className="mt-3 rounded-sm bg-surface px-3 py-2.5 text-[13px] leading-5 text-soft">
              <span className="block font-semibold text-ink">{eventShareExpiryLabel(link.expiresAt)}</span>
              링크를 받은 사람은 로그인하고 이 팀에 합류할 수 있어요. 메모는 보이지 않아요
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={copy}>
                링크 복사
              </Button>
              <Button variant="kakao" onClick={shareKakao} loading={kakaoBusy}>
                {!kakaoBusy && <KakaoSymbol />}
                카카오톡으로 공유
              </Button>
            </div>
            <div className="mt-2 flex justify-center gap-4">
              {canOsShare && (
                <button type="button" onClick={share} className={textButton}>
                  다른 앱으로 보내기
                </button>
              )}
              <button type="button" onClick={() => setConfirm(true)} className={`${textButton} text-danger hover:text-danger`}>
                링크 끊기
              </button>
            </div>
          </>
        ) : createError ? (
          <div className="mt-3">
            <ErrorState message={messageOf(createError, "링크를 만들지 못했어요")} onRetry={onRetry} />
          </div>
        ) : (
          <div aria-busy="true" className="mt-3 space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        )}
      </Sheet>
      <ConfirmDialog
        open={confirm}
        title="일정 링크를 끊을까요?"
        body="이미 보낸 링크는 더 이상 열리지 않아요"
        confirmLabel="끊기"
        danger
        loading={revoking}
        onConfirm={cut}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
