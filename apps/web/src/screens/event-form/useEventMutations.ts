"use client";
// (#497) 일정 폼의 저장, 삭제 요청 훅과 AI 비서 출처. EventFormScreen 에서 옮김
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useEventDeleteToast } from "@/components/useEventDeleteToast";
import { useCreateEvent, useDeleteEvent, useUpdateEvent } from "@/hooks";
import { editSource, FROM_ASSISTANT } from "@/lib/assistant";
import type { EventDraft } from "@/lib/event-draft";

type Args = {
  groupId: number;
  /** 수정, 복제할 일정 ID. 있으면 새 일정이 아니다 */
  sourceId: number | undefined;
  query: ReadonlyURLSearchParams;
  /** 처음 채운 값 (useEventDraft initial) */
  initial: EventDraft | null;
  draft: EventDraft;
};

export function useEventMutations({ groupId, sourceId, query, initial, draft }: Args) {
  // (#450) AI 비서 [고치기]로 연 새 일정 폼(?from=assistant). 저장 요청에 X-Client-Source 를 싣는다 (AI-비서.md 6-1)
  const fromAssistant = !sourceId && query.get("from") === FROM_ASSISTANT;
  const source = fromAssistant && initial ? editSource(initial, draft) : null;
  // 성공 뒤 달력으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const create = useCreateEvent(groupId, { keepPendingAfterSuccess: true, source });
  const update = useUpdateEvent(groupId, { keepPendingAfterSuccess: true });
  const remove = useDeleteEvent(groupId, { keepPendingAfterSuccess: true });
  const deletedToast = useEventDeleteToast(groupId);
  const saving = create.isPending || update.isPending;
  const deleting = remove.isPending;
  return { fromAssistant, create, update, remove, deletedToast, saving, deleting };
}
