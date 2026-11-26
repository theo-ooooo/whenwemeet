"use client";
// (#515) 운영 숨김 팀 안내 모달 (D-286). 폰은 아래에서 올라오는 시트, 넓은 화면은 가운데 창.
// 일반 시트(400 폭, 18px 제목)는 이 안내에 비해 작아 보여 전용 큰 창으로 그린다.
// 닫기(✕, 바깥, Esc)도 "다른 팀 열기" 와 같다: 숨긴 팀 안에 머물지 않게 한다. "팀 나가기" 는 팀 설정과 같은 확인 창
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useToast } from "./Toast";
import { IconShield } from "./icons";
import { Button, CloseButton, ConfirmDialog } from "./ui";
import { useEscape } from "./ui/useEscape";
import { messageOf, useLeaveGroup } from "@/hooks";
import { forgetGroup } from "@/lib/group-cookie";
import type { GroupSummary } from "@/lib/types";

const GROUP_HIDDEN_TITLE = "이 팀은 이용이 제한됐어요";

export function GroupHiddenModal({ team, reason, onOpenOther }: { team: GroupSummary; reason: string; onOpenOther: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  // 성공 뒤 홈으로 이동하므로 이동 중 버튼을 로딩으로 둔다 (팀 설정 나가기와 같다)
  const { mutate, isPending: leaving } = useLeaveGroup(team.id, { keepPendingAfterSuccess: true });
  const last = team.memberCount <= 1;
  const open = !confirm;
  useEscape(open, onOpenOther);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  async function leave() {
    const r = await mutate();
    if (!r.ok) {
      toast.show(messageOf(r.error, "나가지 못했어요. 다시 시도해 주세요"));
      setConfirm(false);
      return;
    }
    forgetGroup();
    router.replace("/");
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center lg:items-center">
          <button type="button" aria-label="닫기" onClick={onOpenOther} className="anim-fade absolute inset-0 bg-[var(--scrim)]" tabIndex={-1} />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="anim-sheet relative w-full rounded-t-2xl bg-paper px-6 pb-[calc(28px+var(--sab))] pt-3 outline-none fold:max-w-[520px] lg:max-w-[520px] lg:rounded-2xl lg:border lg:border-line lg:px-10 lg:pb-10 lg:pt-6 lg:shadow-[var(--pop-shadow)]"
          >
            <div aria-hidden="true" className="mx-auto mb-1 h-1 w-9 rounded-full bg-[var(--grab)] lg:hidden" />
            <div className="flex justify-end">
              <CloseButton onClick={onOpenOther} />
            </div>
            <div className="flex flex-col items-center break-keep text-center">
              <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-danger">
                <IconShield size={30} />
              </span>
              <p className="mt-4 text-[14px] font-bold text-danger">{team.name}</p>
              <h2 id={titleId} className="mt-1 text-[24px] font-bold leading-8 tracking-[-0.03em]">
                {GROUP_HIDDEN_TITLE}
              </h2>
              <p className="mt-2 text-balance text-[15px] leading-6 text-soft">운영 정책 위반이 확인돼 이 팀의 달력과 일정을 지금은 볼 수 없어요.</p>
            </div>
            {reason && (
              <div className="mt-6 rounded-lg bg-surface px-5 py-4">
                <p className="text-[13px] font-semibold text-ink-2">사유</p>
                <p className="mt-1 whitespace-pre-line break-words text-[16px] leading-6 text-ink">{reason}</p>
              </div>
            )}
            <p className="mt-4 break-keep text-center text-[14px] leading-[22px] text-soft">
              잘못된 조치라고 생각되면{" "}
              <Link href="/support" className="font-semibold text-ink underline underline-offset-2">
                고객 지원
              </Link>
              으로 알려 주세요.
            </p>
            <div className="mt-7 flex flex-col gap-2">
              <Button size="lg" full onClick={onOpenOther}>
                다른 팀 열기
              </Button>
              <Button size="lg" full variant="secondary" onClick={() => setConfirm(true)}>
                팀 나가기
              </Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={last ? "마지막 멤버예요" : "팀을 나갈까요?"}
        body={last ? "나가면 팀과 모든 일정이 삭제돼요" : "나가도 내가 만든 일정은 팀에 남아요"}
        confirmLabel={last ? "팀 삭제하고 나가기" : "나가기"}
        danger
        loading={leaving}
        onConfirm={leave}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
