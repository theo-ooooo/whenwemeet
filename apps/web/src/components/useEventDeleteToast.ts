"use client";
import { useCallback } from "react";
import { useGroupContext } from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { messageOf, useRestoreEvent } from "@/hooks";

/** (#375) 삭제 토스트가 떠 있는 시간. 되돌리기 버튼을 누를 수 있는 시간이다 (D-251) */
export const UNDO_TOAST_MS = 7000;

/**
 * (#375) 일정 삭제 뒤 "일정을 삭제했어요 · 되돌리기" 토스트 (D-251). 할 일, 기념일 삭제와 같은 토스트.
 * 되돌리면 달력이 다시 받도록 eventsRestored 를 부른다. deletionId 가 없으면(예전 API) 버튼 없이 알린다
 */
export function useEventDeleteToast(groupId: number) {
  const toast = useToast();
  const { eventsRestored } = useGroupContext();
  const restore = useRestoreEvent(groupId);
  const restoreEvent = restore.mutate;
  return useCallback(
    (deletionId: number | undefined) => {
      if (!deletionId) {
        toast.show("일정을 삭제했어요");
        return;
      }
      toast.show("일정을 삭제했어요", {
        actionLabel: "되돌리기",
        duration: UNDO_TOAST_MS,
        onAction: async () => {
          const r = await restoreEvent(deletionId);
          if (!r.ok) {
            toast.show(messageOf(r.error, "되돌리지 못했어요. 다시 시도해 주세요"));
            return;
          }
          eventsRestored();
          toast.show("일정을 되돌렸어요");
        },
      });
    },
    [toast, restoreEvent, eventsRestored],
  );
}
