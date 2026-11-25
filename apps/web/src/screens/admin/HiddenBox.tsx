// (#515) 관리자 상세의 숨김 상태 상자 (사유, 시각, 숨긴 관리자)
import { adminDateTime } from "@/lib/admin";
import type { HiddenState } from "@/lib/types";

export function HiddenBox({ hidden }: { hidden: HiddenState }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3.5 py-3">
      <p className="text-[12px] font-bold text-danger">숨김</p>
      <p className="mt-0.5 whitespace-pre-line break-words text-[14px] leading-5">{hidden.reason}</p>
      <p className="t-sub mt-1">
        {adminDateTime(hidden.hiddenAt)}, {hidden.hiddenBy?.nickname ?? "탈퇴한 관리자"}
      </p>
    </div>
  );
}

/** 이름 ……… 값 한 줄 (상세 정보 표) */
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-start gap-3 py-2">
      <dt className="w-20 shrink-0 text-[13px] font-semibold text-ink-2">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-[14px] leading-5">{children}</dd>
    </div>
  );
}
