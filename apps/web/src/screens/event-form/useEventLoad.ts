"use client";
// (#497) 수정, 복제할 일정을 받아 폼에 채우고, 사라진 일정(404)이면 안내 후 달력으로 보낸다. 화면 위 오류 줄 상태도 여기. EventFormScreen 에서 옮김
import type { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { useToast } from "@/components/Toast";
import { messageOf, useEvent } from "@/hooks";
import { missingEventTarget } from "@/lib/calendar-url";
import { todayKey } from "@/lib/date";
import { draftFromEvent, type EventDraft } from "@/lib/event-draft";
import type { EventDetailData } from "@/lib/types";

type Args = {
  groupId: number;
  eventId: number | undefined;
  sourceId: number | undefined;
  occurrence: string | null | undefined;
  initialEvent: EventDetailData | null;
  editing: boolean;
  loaded: boolean;
  load: (draft: EventDraft) => void;
  router: ReturnType<typeof useRouter>;
  toast: ReturnType<typeof useToast>;
};

export function useEventLoad({ groupId, eventId, sourceId, occurrence, initialEvent, editing, loaded, load, router, toast }: Args) {
  // 화면 위 오류 줄. 불러오기 실패와 저장, 삭제 실패가 함께 쓴다 (효과의 의존 배열을 그대로 두려고 상태를 여기에 둔다)
  const [saveError, setSaveError] = useState<string | null>(null);

  // 수정(또는 복제)이면 기존 일정을 받아 폼에 채운다. 다시 받으면 다시 채운다
  const eventQ = useEvent(groupId, sourceId, occurrence, { initialData: initialEvent });
  const loadedEvent = eventQ.data;
  useEffect(() => {
    if (!loadedEvent) return;
    const next = draftFromEvent(loadedEvent, !eventId);
    // 효과 본문에서 직접 setState 하지 않도록 마이크로태스크로 미룬다
    queueMicrotask(() => load(next));
  }, [loadedEvent, eventId, load]);
  const creator = editing && loaded ? (loadedEvent?.creator ?? null) : null;

  const loadError = eventQ.error;
  // 회차 주소가 404 면 원본이 아직 있는지 occurrence 없이 한 번 더 본다 (QA3-L7, lib/calendar-url missingEventTarget)
  const occurrenceMissing = loadError?.status === 404 && Boolean(occurrence);
  const seriesQ = useEvent(groupId, sourceId, null, { enabled: occurrenceMissing });
  const seriesSettled = !occurrenceMissing || seriesQ.data !== null || seriesQ.error !== null;
  const seriesAlive = seriesQ.data !== null;
  const goneHandled = useRef(false);
  useEffect(() => {
    if (!loadError) return;
    if (loadError.status === 404) {
      if (!seriesSettled || goneHandled.current) return;
      goneHandled.current = true;
      const target = missingEventTarget(occurrence, seriesAlive, todayKey());
      queueMicrotask(() => {
        toast.show(target.deleted ? "이미 삭제된 일정이에요" : "일정이 바뀌어서 그날 일정을 열었어요");
        router.replace(target.href);
      });
      return;
    }
    queueMicrotask(() => setSaveError(messageOf(loadError, "일정을 불러오지 못했어요. 새로고침해 주세요")));
  }, [loadError, seriesSettled, seriesAlive, occurrence, groupId, router, toast]);

  return { loadedEvent, creator, saveError, setSaveError };
}
