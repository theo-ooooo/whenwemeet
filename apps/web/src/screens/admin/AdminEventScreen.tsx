"use client";
// (#515) 관리자 일정 상세: 제목, 팀, 시각, 만든 사람, 메모와 장소(상세에서만), 숨기기 / 숨김 해제 / 삭제 (D-286)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { Button, ConfirmDialog, ErrorState, InlineError, Skeleton } from "@/components/ui";
import { messageOf, useAdminEvent, useDeleteTarget, useHideTarget, useUnhideTarget } from "@/hooks";
import { adminDateTime, adminEventTime } from "@/lib/admin";
import type { AdminEventDetail } from "@/lib/types";
import { StatusBadge } from "./AdminMore";
import { HiddenBox, InfoRow } from "./HiddenBox";
import { HideDialog } from "./ModerationDialogs";

export function AdminEventScreen({ id }: { id: number }) {
  const router = useRouter();
  const q = useAdminEvent(id);
  const [dialog, setDialog] = useState<"hide" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hide = useHideTarget<AdminEventDetail>("events");
  const unhide = useUnhideTarget<AdminEventDetail>("events");
  const remove = useDeleteTarget("events", { keepPendingAfterSuccess: true });

  if (q.error && !q.data) return <ErrorState message={messageOf(q.error, "일정을 불러오지 못했어요")} onRetry={q.refetch} />;
  const e = q.data;
  if (!e) return <Skeleton className="h-[320px] w-full rounded-xl" />;

  async function onHide(reason: string) {
    const r = await hide.mutate({ id, reason });
    setDialog(null);
    if (r.ok) q.setData(r.data);
    else setError(messageOf(r.error, "숨기지 못했어요"));
  }
  async function onUnhide() {
    const r = await unhide.mutate(id);
    if (r.ok) q.setData(r.data);
    else setError(messageOf(r.error, "숨김을 풀지 못했어요"));
  }
  async function onDelete() {
    const r = await remove.mutate(id);
    if (!r.ok) {
      setDialog(null);
      setError(messageOf(r.error, "삭제하지 못했어요"));
      return;
    }
    router.push("/admin/events");
  }

  return (
    <div className="max-w-[960px]">
      <AdminTitle title={e.title} sub={`일정 #${e.id}`} />
      {error && <InlineError className="mb-2">{error}</InlineError>}
      <section className="rounded-xl bg-paper px-4 py-3">
        <dl className="divide-y divide-line">
          <InfoRow label="상태">{e.hidden ? <StatusBadge tone="warn">숨김</StatusBadge> : <StatusBadge tone="on">정상</StatusBadge>}</InfoRow>
          <InfoRow label="팀">
            <Link href={`/admin/teams/${e.group.id}`} className="font-semibold underline underline-offset-2">
              {e.group.name} #{e.group.id}
            </Link>
            {e.group.hidden && <span className="ml-1.5 text-[12px] font-bold text-danger">숨긴 팀</span>}
          </InfoRow>
          <InfoRow label="시작">
            {adminEventTime(e.startsAt, e.allDay)}
            {e.repeat && <span className="t-sub"> (반복)</span>}
          </InfoRow>
          <InfoRow label="만든 사람">
            {e.creator ? (
              <Link href={`/admin/users/${e.creator.id}`} className="underline underline-offset-2">
                {e.creator.nickname}
              </Link>
            ) : (
              "탈퇴한 멤버"
            )}
            <span className="t-sub">, {adminDateTime(e.createdAt)}</span>
          </InfoRow>
          <InfoRow label="장소">{e.place ?? <span className="text-ink-2">없음</span>}</InfoRow>
          <InfoRow label="메모">{e.memo ? <span className="whitespace-pre-line">{e.memo}</span> : <span className="text-ink-2">없음</span>}</InfoRow>
        </dl>
        {e.hidden && (
          <div className="mt-2 pb-1">
            <HiddenBox hidden={e.hidden} />
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          {e.hidden ? (
            <Button variant="outline" size="sm" loading={unhide.isPending} onClick={() => void onUnhide()}>
              숨김 해제
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setDialog("hide")}>
              숨기기
            </Button>
          )}
          <Button variant="danger" size="sm" className="ml-auto" onClick={() => setDialog("delete")}>
            일정 삭제
          </Button>
        </div>
      </section>
      <HideDialog
        open={dialog === "hide"}
        title="이 일정을 숨길까요?"
        body="팀 멤버의 달력, 검색, 알림, 공유 링크에서 사라져요. 숨김을 풀면 그대로 돌아와요"
        loading={hide.isPending}
        onConfirm={(reason) => void onHide(reason)}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title="이 일정을 삭제할까요?"
        body={e.repeat ? "반복 일정은 모든 회차가 지워지고 되돌릴 수 없어요" : "삭제하면 되돌릴 수 없어요"}
        confirmLabel="삭제"
        danger
        loading={remove.isPending}
        onConfirm={() => void onDelete()}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
