"use client";
// (#515) 관리자 숨기기(사유 입력), 팀 삭제(팀 이름 입력) 확인 창 (D-286)
import { useState } from "react";
import { ConfirmDialog, inputClass } from "@/components/ui";
import { HIDE_REASON_MAX } from "@/lib/admin";

/** 숨기기: 사유 1~200자를 적어야 버튼이 켜진다. 사유는 멤버에게 그대로 보인다(팀) */
export function HideDialog({
  open,
  title,
  body,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  loading: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 1 && reason.trim().length <= HIDE_REASON_MAX;
  return (
    <ConfirmDialog
      open={open}
      title={title}
      body={body}
      confirmLabel="숨기기"
      danger
      loading={loading}
      confirmDisabled={!ok}
      onConfirm={() => {
        if (ok) onConfirm(reason.trim());
      }}
      onCancel={() => {
        setReason("");
        onCancel();
      }}
    >
      <label className="mt-3 block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">
          사유 ({reason.trim().length}/{HIDE_REASON_MAX})
        </span>
        <textarea className={`${inputClass} min-h-[88px] resize-none`} value={reason} maxLength={HIDE_REASON_MAX + 20} onChange={(e) => setReason(e.target.value)} />
      </label>
      {!ok && <p className="t-sub mt-1">사유를 적어야 숨길 수 있어요</p>}
    </ConfirmDialog>
  );
}

/** 팀 삭제: 팀 이름을 그대로 적어야 지운다 (모든 멤버에게서 사라지고 되돌릴 수 없다) */
export function DeleteTeamDialog({ open, name, loading, onConfirm, onCancel }: { open: boolean; name: string; loading: boolean; onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === name.trim();
  return (
    <ConfirmDialog
      open={open}
      title="이 팀을 삭제할까요?"
      body="모든 멤버에게서 팀과 일정, 기념일, 할 일, 투표가 지워지고 되돌릴 수 없어요"
      confirmLabel="삭제"
      danger
      loading={loading}
      confirmDisabled={!ok}
      onConfirm={() => {
        if (ok) onConfirm();
      }}
      onCancel={() => {
        setTyped("");
        onCancel();
      }}
    >
      <label className="mt-3 block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">
          계속하려면 팀 이름 <b className="text-ink">{name}</b> 을 입력해 주세요
        </span>
        <input className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
    </ConfirmDialog>
  );
}
