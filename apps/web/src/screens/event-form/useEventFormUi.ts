"use client";
// (#497) 일정 폼의 시트, 확인 창, 참여자 오류 줄 상태 (화면 위 오류 줄은 useEventLoad). EventFormScreen 에서 옮김
import { useCallback, useRef, useState } from "react";
import type { EventScope } from "@/lib/types";

/** 시트와 확인 창. 한 번에 하나만 뜬다 ("이후 모두" 확인은 범위 시트 위에 겹친다) */
export type Dialog =
  | { kind: "repeat" }
  | { kind: "reminder" }
  | { kind: "participants" }
  | { kind: "color" }
  | { kind: "scope"; mode: "save" | "delete"; confirmFollowing?: boolean };

export function useEventFormUi() {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  // 고른 범위의 요청 중 표시 (범위 시트, 확인 창의 버튼)
  const [scopePending, setScopePending] = useState<EventScope | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);
  // 제목을 한 번이라도 고쳤는지. 빈 제목 오류는 고친 뒤 벗어나거나 저장을 눌렀을 때만 띄운다 (#80)
  const titleEdited = useRef(false);

  /** 범위 시트를 닫는다 (위에 뜬 확인 창도). 다른 시트는 그대로 */
  const closeScope = () => setDialog((d) => (d?.kind === "scope" ? null : d));

  return {
    dialog,
    setDialog,
    closeDialog,
    closeScope,
    scopePending,
    setScopePending,
    participantError,
    setParticipantError,
    titleEdited,
  };
}
