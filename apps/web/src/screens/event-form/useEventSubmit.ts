"use client";
// (#497) 일정 폼의 저장과 삭제: 반복 일정 범위 묻기, 요청, 성공 뒤 이동, 실패 문장. EventFormScreen 에서 옮김
import type { useRouter } from "next/navigation";
import type { useToast } from "@/components/Toast";
import { messageOf } from "@/hooks";
import { haptic } from "@/lib/app-bridge";
import { dateKeyOf } from "@/lib/date";
import { eventBody, type EventDraft } from "@/lib/event-draft";
import type { ParticipantPick } from "@/lib/participants";
import { maybeOpenPushPrompt } from "@/lib/push";
import { CALENDAR_PATH, calendarHref } from "@/lib/routes";
import type { EventDetailData, EventInput, EventScope } from "@/lib/types";
import type { useEventFormUi } from "./useEventFormUi";
import type { useEventMutations } from "./useEventMutations";

type Ui = ReturnType<typeof useEventFormUi>;
type Mutations = ReturnType<typeof useEventMutations>;

type Args = {
  eventId: number | undefined;
  editing: boolean;
  personal: boolean;
  presetScope: EventScope | null;
  draft: EventDraft;
  touch: () => void;
  payload: EventInput | null;
  series: EventDetailData | null;
  /** (#500) 불러온 일정의 원래 날짜 (반복 회차면 그 회차). 삭제 뒤 달력은 폼에서 고친 날이 아니라 이 날로 간다 */
  loadedDate: string | null;
  canSave: boolean;
  showParticipants: boolean;
  currentPick: ParticipantPick | null;
  initialPick: ParticipantPick | null;
  initialColor: EventDraft["color"] | null;
  dialog: Ui["dialog"];
  setDialog: Ui["setDialog"];
  closeScope: Ui["closeScope"];
  setScopePending: Ui["setScopePending"];
  setParticipantError: Ui["setParticipantError"];
  setSaveError: (message: string | null) => void;
  setDone: (done: boolean) => void;
  create: Mutations["create"];
  update: Mutations["update"];
  remove: Mutations["remove"];
  deletedToast: Mutations["deletedToast"];
  router: ReturnType<typeof useRouter>;
  toast: ReturnType<typeof useToast>;
};

export function useEventSubmit({
  eventId,
  editing,
  personal,
  presetScope,
  draft,
  touch,
  payload,
  series,
  loadedDate,
  canSave,
  showParticipants,
  currentPick,
  initialPick,
  initialColor,
  dialog,
  setDialog,
  closeScope,
  setScopePending,
  setParticipantError,
  setSaveError,
  setDone,
  create,
  update,
  remove,
  deletedToast,
  router,
  toast,
}: Args) {
  const { startDate } = draft;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    touch();
    if (!canSave || !payload) return;
    setSaveError(null);
    setParticipantError(null);
    // 반복 일정은 범위를 먼저 묻는다 (주소로 정해 왔으면 그 범위로 바로)
    if (series && !presetScope) {
      setDialog({ kind: "scope", mode: "save" });
      return;
    }
    await submit(series ? presetScope : null);
  }

  /** 범위 시트에서 고른 뒤. "이후 모두" 인데 뒤에 따로 바꾼 회차가 있으면 한 번 더 묻는다 (기획 3-4) */
  function pickScope(scope: EventScope) {
    if (dialog?.kind === "scope" && dialog.mode === "delete") {
      void removeEvent(scope);
      return;
    }
    if (scope === "following" && series?.hasLaterExceptions) {
      setDialog({ kind: "scope", mode: "save", confirmFollowing: true });
      return;
    }
    void submit(scope);
  }

  async function submit(scope: EventScope | null) {
    if (!payload) return;
    const input = eventBody({ draft, input: payload, scope, series, editing, personal, showParticipants, currentPick, initialPick, initialColor });
    // "이후 모두" 확인 창을 닫고 범위 시트는 요청이 끝날 때까지 둔다
    setDialog((d) => (d?.kind === "scope" && d.confirmFollowing ? { kind: "scope", mode: d.mode } : d));
    setScopePending(scope);
    const target = series && scope ? { occurrence: series.occurrence ?? undefined, scope } : {};
    const r = eventId ? await update.mutate({ eventId, input, ...target }) : await create.mutate(input as EventInput);
    setScopePending(null);
    closeScope();
    if (r.ok) {
      setDone(true);
      haptic("success");
      // 권한 안내 시트 계기 ① 일정 저장 성공 직후 (푸시 지원 앱에서 한 번만, 8-1). 시트는 루트에 있어 화면이 바뀌어도 남는다
      void maybeOpenPushPrompt();
      router.push(calendarHref({ date: dateKeyOf(payload.startsAt) }));
      return;
    }
    if (r.error.status === 404) {
      toast.show("이미 삭제된 일정이에요");
      router.replace(CALENDAR_PATH);
      return;
    }
    // 참여자 검증 실패(멤버가 방금 나감 등)는 참여자 줄 아래에 (#248 7-3)
    const participantDetail = r.error.details?.find((d) => d.field === "participants");
    if (participantDetail) {
      setParticipantError(participantDetail.message || r.error.message);
      return;
    }
    setSaveError(messageOf(r.error, "저장하지 못했어요. 입력 내용은 그대로 있으니 다시 저장해 주세요"));
  }

  async function removeEvent(scope: EventScope | null = null) {
    if (!eventId) return;
    setScopePending(scope);
    const target = series && scope ? { occurrence: series.occurrence ?? undefined, scope } : {};
    const r = await remove.mutate({ eventId, ...target });
    setScopePending(null);
    closeScope();
    if (r.ok) {
      setDone(true);
      // (#375) 7초 안 되돌리기. 달력으로 옮긴 뒤 되돌려도 달력이 다시 받는다 (D-251)
      deletedToast(r.data.deletionId);
      router.replace(calendarHref({ date: loadedDate ?? startDate }));
      return;
    }
    setSaveError(messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
  }

  return { save, pickScope, submit, removeEvent };
}
