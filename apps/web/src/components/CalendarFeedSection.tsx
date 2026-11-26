"use client";
// (#193) 팀 설정 "다른 캘린더 앱에서 보기": 내 연결 주소(ICS 피드) 만들기, 아이폰 캘린더에 추가, 복사(구글 안내), 메모와 기념일 토글, 다시 만들기, 연결 끊기
// (#378) 팀 설정에서는 "연결" 묶음의 줄을 누르면 뜨는 시트 안에 그린다(bare: 카드와 제목 없이, 시트 제목이 같은 말)
import { useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/Toast";
import { Button, ConfirmDialog, Sheet, Skeleton, Toggle } from "@/components/ui";
import { messageOf, useCalendarFeed, useDeleteCalendarFeed, useRotateCalendarFeed, useSaveCalendarFeed, type CalendarFeedSettings } from "@/hooks";
import { FEED_COPY, feedOnNote, feedPlatform, feedSheetPoints, lastFetchedText, SERVER_PLATFORM, type FeedPlatform } from "@/lib/calendar-feed";

const noopSubscribe = () => () => {};
let platformCache: { ua: string; value: FeedPlatform } | null = null;
/** useSyncExternalStore 는 같은 값을 돌려받아야 다시 그리지 않으므로 UA 별로 한 번만 만든다 */
function clientPlatform(): FeedPlatform {
  const ua = navigator.userAgent;
  if (platformCache?.ua !== ua) platformCache = { ua, value: feedPlatform(ua, navigator.maxTouchPoints ?? 0) };
  return platformCache.value;
}

const textButton = "hit rounded-sm px-1 py-2 text-[12px] font-medium underline underline-offset-2";
/** 링크를 보조 버튼(secondary, md)과 같은 모양으로 */
const linkButton = "flex h-11 w-full items-center justify-center rounded-md bg-hover px-4 text-[13.5px] font-bold text-ink hover:brightness-95";

export function CalendarFeedSection({ groupId, personal, bare = false }: { groupId: number; personal: boolean; bare?: boolean }) {
  const toast = useToast();
  const { data: feed, error, isLoading, refetch, setData } = useCalendarFeed(groupId);
  const { mutate: save, isPending: saving } = useSaveCalendarFeed(groupId);
  const { mutate: rotate, isPending: rotating } = useRotateCalendarFeed(groupId);
  const { mutate: remove, isPending: removing } = useDeleteCalendarFeed(groupId);
  const platform = useSyncExternalStore(noopSubscribe, clientPlatform, () => SERVER_PLATFORM);
  const [dialog, setDialog] = useState<"create" | "memo" | "rotate" | "off" | null>(null);

  async function update(input: CalendarFeedSettings): Promise<boolean> {
    const r = await save(input);
    if (!r.ok) {
      toast.show(messageOf(r.error, FEED_COPY.saveFailed));
      return false;
    }
    setData(r.data);
    return true;
  }

  async function create() {
    if (await update({})) setDialog(null);
  }

  async function toggle(input: CalendarFeedSettings) {
    if (saving || !feed) return;
    const before = feed;
    setData({ ...feed, ...input });
    if (!(await update(input))) setData(before);
  }

  async function copy() {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.httpsUrl);
      toast.show(FEED_COPY.copied);
    } catch {
      toast.show(FEED_COPY.copyFailed);
    }
  }

  async function doRotate() {
    const r = await rotate();
    if (!r.ok) {
      toast.show(messageOf(r.error, FEED_COPY.saveFailed));
      return;
    }
    setData(r.data);
    setDialog(null);
    toast.show(FEED_COPY.rotated);
  }

  async function turnOff() {
    const r = await remove();
    if (!r.ok) {
      toast.show(messageOf(r.error, FEED_COPY.saveFailed));
      return;
    }
    setData(null);
    setDialog(null);
    toast.show(FEED_COPY.turnedOff);
  }

  const body = (
    <>
      {feed === null && isLoading ? (
        <div aria-busy="true" aria-label="불러오는 중" className="mt-2 space-y-2">
          <Skeleton className="h-5 w-4/5 rounded-sm" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      ) : feed === null && error ? (
        <div className="mt-1">
          <p className="text-[13px] leading-5 text-soft">{FEED_COPY.loadFailed}</p>
          <button type="button" onClick={() => void refetch()} className={`${textButton} text-ink-2 hover:text-ink`}>
            다시 시도
          </button>
        </div>
      ) : feed === null ? (
        <>
          <p className="mt-0.5 text-[13px] leading-5 text-soft">{personal ? FEED_COPY.offPersonal : FEED_COPY.offTeam}</p>
          {!personal && <p className="t-sub mt-1">{FEED_COPY.offTeamNote}</p>}
          <Button variant="secondary" full className="mt-3" onClick={() => setDialog("create")}>
            {FEED_COPY.create}
          </Button>
        </>
      ) : (
        <>
          <p className="mt-0.5 text-[13px] leading-5 text-soft">{feedOnNote(personal)}</p>
          <div className="mt-3 space-y-2">
            {platform.apple && (
              <a href={feed.webcalUrl} className={linkButton}>
                {FEED_COPY.apple}
              </a>
            )}
            <Button variant="secondary" full onClick={copy}>
              {FEED_COPY.copy}
            </Button>
            {/* 구글 캘린더는 앱에서 URL 추가를 못 하고(컴퓨터 웹에서만), 붙여 넣기 안내가 가장 덜 헷갈린다 */}
            <p className="t-sub text-center">
              {FEED_COPY.google}
              {platform.mobile && <span className="block">{FEED_COPY.googleMobile}</span>}
            </p>
          </div>
          <div className="mt-2 divide-y divide-line">
            <Toggle
              checked={feed.includeMemo}
              onChange={(v) => (v ? setDialog("memo") : void toggle({ includeMemo: false }))}
              label={FEED_COPY.memo}
              description={feed.includeMemo ? FEED_COPY.memoOn : FEED_COPY.memoOff}
            />
            <Toggle
              checked={feed.includeAnniversaries}
              onChange={(v) => void toggle({ includeAnniversaries: v })}
              label={FEED_COPY.anniversaries}
              description={FEED_COPY.anniversariesDesc}
            />
          </div>
          <p className="t-sub mt-2">{lastFetchedText(feed.lastFetchedAt)}</p>
          <p className="t-sub">{FEED_COPY.delay}</p>
          <div className="mt-1 flex justify-center gap-4">
            <button type="button" onClick={() => setDialog("rotate")} className={`${textButton} text-ink-2 hover:text-ink`}>
              {FEED_COPY.rotate}
            </button>
            <button type="button" onClick={() => setDialog("off")} className={`${textButton} text-danger`}>
              {FEED_COPY.off}
            </button>
          </div>
        </>
      )}

      <Sheet open={dialog === "create"} onClose={() => setDialog(null)} title={FEED_COPY.sheetTitle}>
        <ul className="space-y-2.5 pb-1">
          {feedSheetPoints(personal).map((point) => (
            <li key={point} className="flex gap-2 text-[14px] leading-5">
              <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ink-2" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <Button full size="lg" className="mt-4" onClick={create} loading={saving}>
          {FEED_COPY.sheetConfirm}
        </Button>
      </Sheet>
      <ConfirmDialog
        open={dialog === "memo"}
        title={FEED_COPY.memoConfirmTitle}
        body={FEED_COPY.memoConfirmBody}
        confirmLabel={FEED_COPY.memo}
        neutral
        loading={saving}
        onConfirm={async () => {
          await toggle({ includeMemo: true });
          setDialog(null);
        }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "rotate"}
        title={FEED_COPY.rotateTitle}
        body={FEED_COPY.rotateBody}
        confirmLabel={FEED_COPY.rotateConfirm}
        neutral
        loading={rotating}
        onConfirm={doRotate}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "off"}
        title={FEED_COPY.offTitle}
        body={FEED_COPY.offBody}
        confirmLabel={FEED_COPY.off}
        danger
        loading={removing}
        onConfirm={turnOff}
        onCancel={() => setDialog(null)}
      />
    </>
  );
  if (bare) return <div className="pb-1">{body}</div>;
  return (
    <section className="rounded-xl bg-paper px-3.5 py-3.5" aria-labelledby="calendar-feed-title">
      <h2 id="calendar-feed-title" className="text-[13px] font-bold leading-5">
        {FEED_COPY.title}
      </h2>
      {body}
    </section>
  );
}
