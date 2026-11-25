"use client";
// (#515) 운영 숨김 팀 안내 모달 (D-286). 앱의 시트(폰은 아래에서 올라오는 시트, 넓은 화면은 가운데 창)를 쓴다.
// 닫기(✕, 바깥, Esc)도 "다른 팀 열기" 와 같다: 숨긴 팀 안에 머물지 않게 한다. "팀 나가기" 는 팀 설정과 같은 확인 창
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "./Toast";
import { Button, ConfirmDialog, Sheet } from "./ui";
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
      <Sheet open={!confirm} onClose={onOpenOther} title={GROUP_HIDDEN_TITLE}>
        <p className="text-[13px] font-bold text-danger">
          이용 제한<span className="font-semibold text-ink-2">, {team.name}</span>
        </p>
        {reason && (
          <div className="mt-3 rounded-md bg-surface px-3.5 py-3">
            <p className="text-[12px] font-semibold text-ink-2">사유</p>
            <p className="mt-0.5 whitespace-pre-line break-words text-[14px] leading-5 text-ink">{reason}</p>
          </div>
        )}
        <p className="mt-3 text-[14px] leading-[22px] text-soft">
          잘못된 조치라고 생각되면{" "}
          <Link href="/support" className="font-semibold text-ink underline underline-offset-2">
            고객 지원
          </Link>
          으로 알려 주세요.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button size="lg" full onClick={onOpenOther}>
            다른 팀 열기
          </Button>
          <Button size="lg" full variant="secondary" onClick={() => setConfirm(true)}>
            팀 나가기
          </Button>
        </div>
      </Sheet>
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
