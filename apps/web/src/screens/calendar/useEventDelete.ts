"use client";
// (#484) 열린 일정 상세의 삭제: 확인 창, 반복 일정 범위 시트 (#187), 되돌리기 토스트 (#375). CalendarScreen 에서 옮김
import { useState } from "react";
import type { useToast } from "@/components/Toast";
import { useEventDeleteToast } from "@/components/useEventDeleteToast";
import { messageOf, useDeleteEvent } from "@/hooks";
import type { Event, EventScope } from "@/lib/types";

type Args = {
  groupId: number;
  /** 지금 열린 일정 상세의 일정 */
  surfaceEvent: Event | undefined;
  toast: ReturnType<typeof useToast>;
  /** 지운 뒤 날짜 상세로 돌아간다 */
  back: () => void;
  reload: () => void;
};

export function useEventDelete({ groupId, surfaceEvent, toast, back, reload }: Args) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useDeleteEvent(groupId);
  const deletedToast = useEventDeleteToast(groupId);
  // 반복 일정 삭제는 범위 시트 (#187). 고른 범위의 요청 중 표시
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopePending, setScopePending] = useState<EventScope | null>(null);
  function askDelete() {
    if (surfaceEvent?.repeat) setScopeOpen(true);
    else setConfirmDelete(true);
  }
  async function removeEvent(scope: EventScope | null = null) {
    if (!surfaceEvent) return;
    setScopePending(scope);
    const target = surfaceEvent.repeat && scope ? { occurrence: surfaceEvent.occurrence ?? undefined, scope } : {};
    const r = await remove.mutate({ eventId: surfaceEvent.id, ...target });
    setScopePending(null);
    setScopeOpen(false);
    setConfirmDelete(false);
    if (!r.ok) {
      if (r.error.status === 404) {
        toast.show("이미 삭제된 일정이에요");
        back();
        reload();
        return;
      }
      toast.show(messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    // (#375) 7초 안 되돌리기 (D-251)
    deletedToast(r.data.deletionId);
    back();
    reload();
  }

  return { confirmDelete, setConfirmDelete, scopeOpen, setScopeOpen, scopePending, deleting: remove.isPending, askDelete, removeEvent };
}
