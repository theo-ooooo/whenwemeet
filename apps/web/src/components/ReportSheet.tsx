"use client";
// (#536) 신고 시트 (D-289). 일정 상세 ⋯ 메뉴, 팀 설정의 팀 신고, 멤버 줄의 ⋯ 메뉴에서 연다.
// 사유 하나(필수) + 자세한 내용(선택, 500자) + 신고. 성공하면 시트를 닫고 토스트 "신고했어요. 확인 후 조치할게요"
// 같은 대상을 접수 중에 다시 신고하면 서버가 새로 만들지 않고(200 duplicate) "이미 신고했어요" 로 안내한다
import { useId, useState } from "react";
import { IconCheck } from "./icons";
import { useToast } from "./Toast";
import { Button, InlineError, Sheet, captionClass, inputClass } from "./ui";
import { messageOf, useCreateReport } from "@/hooks";
import { REPORT_DETAIL_MAX, REPORT_REASONS, reportDoneText, reportSheetTitle } from "@/lib/report";
import type { ReportReason, ReportTargetType } from "@/lib/types";

export type ReportTarget = { targetType: ReportTargetType; targetId: number; /** 사용자 신고 시트 제목 "하늘 신고" */ name?: string };

export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  return target ? <ReportSheetBody key={`${target.targetType}:${target.targetId}`} target={target} onClose={onClose} /> : null;
}

function ReportSheetBody({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const toast = useToast();
  const labelId = useId();
  const detailId = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { mutate, isPending } = useCreateReport();
  const tooLong = detail.trim().length > REPORT_DETAIL_MAX;

  async function submit() {
    if (!reason || tooLong || isPending) return;
    const text = detail.trim();
    const r = await mutate({ targetType: target.targetType, targetId: target.targetId, reason, ...(text ? { detail: text } : {}) });
    if (!r.ok) {
      setError(messageOf(r.error, "신고하지 못했어요. 잠시 후 다시 해 주세요"));
      return;
    }
    toast.show(reportDoneText(r.data.duplicate));
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={reportSheetTitle(target.targetType, target.name)}>
      <p id={labelId} className="pb-1 text-[13px] leading-5 text-ink-2">
        어떤 문제인가요? 신고는 운영자만 보고, 상대에게 알리지 않아요.
      </p>
      <ul role="radiogroup" aria-labelledby={labelId} className="pb-2">
        {REPORT_REASONS.map((r) => {
          const on = r.value === reason;
          return (
            <li key={r.value}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setReason(r.value);
                  setError(null);
                }}
                className={`flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] hover:bg-hover ${on ? "font-bold" : "font-medium"}`}
              >
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                {on && <IconCheck size={18} className="shrink-0 text-acc-ink" />}
              </button>
            </li>
          );
        })}
      </ul>
      <label htmlFor={detailId} className={captionClass}>
        자세한 내용 (선택, {detail.trim().length}/{REPORT_DETAIL_MAX})
      </label>
      <textarea
        id={detailId}
        className={`${inputClass} min-h-[88px] resize-none`}
        value={detail}
        maxLength={REPORT_DETAIL_MAX + 20}
        placeholder="확인에 도움이 되는 내용을 적어 주세요"
        onChange={(e) => setDetail(e.target.value)}
      />
      {tooLong && <InlineError className="mt-1">{REPORT_DETAIL_MAX}자까지 적을 수 있어요</InlineError>}
      {error && <InlineError className="mt-2">{error}</InlineError>}
      <Button variant="dangerFill" size="xl" full className="mt-4" disabled={!reason || tooLong} loading={isPending} onClick={() => void submit()}>
        신고
      </Button>
    </Sheet>
  );
}
