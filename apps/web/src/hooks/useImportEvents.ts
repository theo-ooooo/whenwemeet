"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { ImportParticipants, ImportPreview, ImportRange, ImportResult } from "@/lib/types";
import { useMutation, type MutationOptions } from "./_useMutation";

/** (#279) 가져오기 입력. 팀은 미리보기 화면에서 바꿀 수 있어 호출마다 받는다 */
export type ImportInput = {
  groupId: number;
  file: Blob;
  range: ImportRange;
  participants?: ImportParticipants;
  /** (#314) 넣을 일정의 key. 생략하면 전부. multipart 는 빈 배열을 못 실어 JSON 문자열로 보낸다 (D-194) */
  include?: string[];
};

function toForm({ file, range, participants, include }: ImportInput): FormData {
  const form = new FormData();
  form.append("range", range);
  if (participants) form.append("participants", participants);
  if (include) form.append("include", JSON.stringify(include));
  form.append("file", file, file instanceof File ? file.name : "calendar.ics");
  return form;
}

/** 미리보기 POST /groups/:id/imports/preview (multipart). 서버는 아무것도 저장하지 않는다 */
export function usePreviewImport(opts?: MutationOptions) {
  const fn = useCallback(
    (input: ImportInput) => api<ImportPreview>(`/groups/${input.groupId}/imports/preview`, { method: "POST", form: toForm(input) }),
    [],
  );
  return useMutation(fn, opts);
}

/** 넣기 POST /groups/:id/imports (multipart). 같은 파일을 다시 올려도 들어간 것은 건너뛴다 */
export function useImportEvents(opts?: MutationOptions) {
  const fn = useCallback(
    (input: ImportInput) => api<ImportResult>(`/groups/${input.groupId}/imports`, { method: "POST", form: toForm(input) }),
    [],
  );
  return useMutation(fn, opts);
}
