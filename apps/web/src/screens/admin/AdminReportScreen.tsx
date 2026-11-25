"use client";
// (#536) 관리자 신고 대상 상세 (D-289). 왼쪽: 대상 미리 보기와 조치, 오른쪽: 그 대상의 신고(최근 것부터). 폰은 위아래로 쌓는다.
// - 팀, 일정: 숨기기 / 숨김 해제 / 삭제. 기존 관리자 숨기기, 삭제 창과 API 를 그대로 쓰고, 숨기거나 지우면 서버가 접수 중 신고를 처리 완료로 닫는다
// - 사용자: 사용자 정지 기능은 없다. 그 사람이 속한 팀을 보이고 팀마다 숨기기로 이어 준다(그 팀의 신고만 닫힌다). 사용자 신고는 처리 완료나 기각으로 닫는다
// - 처리 완료(메모 필수), 기각(메모 선택): 그 대상의 접수 중 신고가 모두 닫힌다
import Link from "next/link";
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { Button, ConfirmDialog, ErrorState, InlineError, Skeleton } from "@/components/ui";
import { messageOf, useAdminReportTarget, useCloseReport, useDeleteTarget, useHideTarget, useUnhideTarget } from "@/hooks";
import { ADMIN_REPORTS_CHANGED, adminDateTime, adminEventTime, adminGroupName, adminPlatformLabels, reportTargetTypeLabel } from "@/lib/admin";
import { reportReasonLabel } from "@/lib/report";
import type { AdminEventDetail, AdminGroup, AdminGroupDetail, AdminReport, AdminReportTargetDetail, ReportTargetType } from "@/lib/types";
import { StatusBadge } from "./AdminMore";
import { ReportStatusBadge } from "./AdminReportsScreen";
import { HiddenBox, InfoRow } from "./HiddenBox";
import { DeleteTeamDialog, HideDialog, ReportCloseDialog } from "./ModerationDialogs";

type Dialog =
  | { kind: "hide"; target: "groups" | "events"; id: number }
  | { kind: "delete"; target: "groups"; id: number; name: string }
  | { kind: "delete"; target: "events"; id: number; repeat: boolean }
  | { kind: "resolve" | "dismiss" };

export function AdminReportScreen({ targetType, targetId }: { targetType: ReportTargetType; targetId: number }) {
  const q = useAdminReportTarget(targetType, targetId);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hideGroup = useHideTarget<AdminGroupDetail>("groups");
  const hideEvent = useHideTarget<AdminEventDetail>("events");
  const unhideGroup = useUnhideTarget<AdminGroupDetail>("groups");
  const unhideEvent = useUnhideTarget<AdminEventDetail>("events");
  const deleteGroup = useDeleteTarget("groups");
  const deleteEvent = useDeleteTarget("events");
  const resolve = useCloseReport("resolve");
  const dismiss = useCloseReport("dismiss");

  if (q.error && !q.data) return <ErrorState message={messageOf(q.error, "신고를 불러오지 못했어요")} onRetry={q.refetch} />;
  const d = q.data;
  if (!d) return <Skeleton className="h-[360px] w-full rounded-xl" />;
  const latestId = d.reports[0]?.id;

  /** 조치 뒤 다시 받는다 (숨기기, 삭제는 서버가 신고를 닫으므로 목록 상태도 바뀐다) */
  async function after(r: { ok: boolean; error: unknown }, fail: string) {
    setDialog(null);
    if (!r.ok) {
      setError(messageOf(r.error as never, fail));
      return;
    }
    setError(null);
    await q.refetch();
    window.dispatchEvent(new Event(ADMIN_REPORTS_CHANGED));
  }
  async function onHide(reason: string) {
    if (dialog?.kind !== "hide") return;
    const m = dialog.target === "groups" ? hideGroup : hideEvent;
    await after(await m.mutate({ id: dialog.id, reason }), "숨기지 못했어요");
  }
  async function onUnhide(target: "groups" | "events", id: number) {
    const m = target === "groups" ? unhideGroup : unhideEvent;
    await after(await m.mutate(id), "숨김을 풀지 못했어요");
  }
  async function onDelete() {
    if (dialog?.kind !== "delete") return;
    const m = dialog.target === "groups" ? deleteGroup : deleteEvent;
    await after(await m.mutate(dialog.id), "삭제하지 못했어요");
  }
  async function onClose(kind: "resolve" | "dismiss", resolution: string) {
    if (latestId === undefined) return;
    const m = kind === "resolve" ? resolve : dismiss;
    const r = await m.mutate({ id: latestId, resolution });
    setDialog(null);
    if (r.ok) {
      setError(null);
      q.setData(r.data);
      window.dispatchEvent(new Event(ADMIN_REPORTS_CHANGED));
    } else setError(messageOf(r.error, kind === "resolve" ? "처리하지 못했어요" : "기각하지 못했어요"));
  }

  const title = targetTitle(d.target, targetType);
  const hidePending = hideGroup.isPending || hideEvent.isPending;
  const deletePending = deleteGroup.isPending || deleteEvent.isPending;

  return (
    <div>
      <AdminTitle
        title={title}
        sub={`${reportTargetTypeLabel(targetType)} #${targetId}, 신고 ${d.reports.length}건${d.openCount > 0 ? ` (접수 ${d.openCount})` : ""}`}
        right={
          <Link href="/admin/reports" className="hit shrink-0 rounded-sm px-2 py-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
            ‹ 신고 목록
          </Link>
        }
      />
      {error && <InlineError className="mb-2">{error}</InlineError>}
      <div className="lg:grid lg:grid-cols-[minmax(340px,460px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="space-y-3 lg:sticky lg:top-7">
          <section className="rounded-xl bg-paper px-4 py-3">
            {d.target ? (
              <TargetPreview
                target={d.target}
                onHide={(target, id) => setDialog({ kind: "hide", target, id })}
                onUnhide={(target, id) => void onUnhide(target, id)}
                unhiding={unhideGroup.isPending || unhideEvent.isPending}
                onDeleteGroup={(g) => setDialog({ kind: "delete", target: "groups", id: g.id, name: adminGroupName(g) })}
                onDeleteEvent={(e) => setDialog({ kind: "delete", target: "events", id: e.id, repeat: Boolean(e.repeat) })}
              />
            ) : (
              <p className="py-2 text-[14px] text-ink-2">이미 지워진 {reportTargetTypeLabel(targetType)}이에요. 남은 신고는 처리 완료나 기각으로 닫아 주세요</p>
            )}
          </section>
          {d.openCount > 0 && (
            <section className="flex flex-wrap gap-2 rounded-xl bg-paper px-4 py-3">
              <p className="t-sub w-full">조치를 했거나 할 필요가 없으면 닫아 주세요. 접수 중 신고 {d.openCount}건이 함께 닫혀요</p>
              <Button variant="ink" size="sm" onClick={() => setDialog({ kind: "resolve" })}>
                처리 완료
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "dismiss" })}>
                기각
              </Button>
            </section>
          )}
        </div>
        <section aria-labelledby="report-list" className="mt-4 lg:mt-0">
          <h2 id="report-list" className="mb-2 px-1 text-[13px] font-bold text-ink-2">
            신고 {d.reports.length}건
          </h2>
          <ul className="divide-y divide-line rounded-xl bg-paper px-4">
            {d.reports.map((r) => (
              <ReportRow key={r.id} r={r} />
            ))}
          </ul>
        </section>
      </div>

      <HideDialog
        open={dialog?.kind === "hide"}
        title={dialog?.kind === "hide" && dialog.target === "events" ? "이 일정을 숨길까요?" : "이 팀을 숨길까요?"}
        body={
          dialog?.kind === "hide" && dialog.target === "events"
            ? "팀 멤버의 달력, 검색, 알림, 공유 링크에서 사라져요. 이 일정의 접수 중 신고는 처리 완료로 닫혀요"
            : "멤버는 이 팀을 볼 수 없고 사유가 담긴 이용 제한 안내를 보게 돼요. 이 팀의 접수 중 신고는 처리 완료로 닫혀요"
        }
        loading={hidePending}
        onConfirm={(reason) => void onHide(reason)}
        onCancel={() => setDialog(null)}
      />
      <DeleteTeamDialog
        open={dialog?.kind === "delete" && dialog.target === "groups"}
        name={dialog?.kind === "delete" && dialog.target === "groups" ? dialog.name : ""}
        loading={deletePending}
        onConfirm={() => void onDelete()}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete" && dialog.target === "events"}
        title="이 일정을 삭제할까요?"
        body={dialog?.kind === "delete" && dialog.target === "events" && dialog.repeat ? "반복 일정은 모든 회차가 지워지고 되돌릴 수 없어요" : "삭제하면 되돌릴 수 없어요"}
        confirmLabel="삭제"
        danger
        loading={deletePending}
        onConfirm={() => void onDelete()}
        onCancel={() => setDialog(null)}
      />
      <ReportCloseDialog
        kind="resolve"
        open={dialog?.kind === "resolve"}
        count={d.openCount}
        loading={resolve.isPending}
        onConfirm={(text) => void onClose("resolve", text)}
        onCancel={() => setDialog(null)}
      />
      <ReportCloseDialog
        kind="dismiss"
        open={dialog?.kind === "dismiss"}
        count={d.openCount}
        loading={dismiss.isPending}
        onConfirm={(text) => void onClose("dismiss", text)}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

function targetTitle(target: AdminReportTargetDetail | null, type: ReportTargetType): string {
  if (!target) return `지워진 ${reportTargetTypeLabel(type)}`;
  if (target.type === "group") return adminGroupName(target.group);
  if (target.type === "event") return target.event.title;
  return target.user.nickname;
}

function ReportRow({ r }: { r: AdminReport }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <b className="text-[14px] font-semibold">{reportReasonLabel(r.reason)}</b>
        <ReportStatusBadge status={r.status} />
        <span className="t-sub ml-auto tabular-nums">
          {r.reporter ? (
            <Link href={`/admin/users/${r.reporter.id}`} className="underline underline-offset-2">
              {r.reporter.nickname}
            </Link>
          ) : (
            "탈퇴한 사용자"
          )}
          , {adminDateTime(r.createdAt)}
        </span>
      </div>
      {r.detail && <p className="mt-1 whitespace-pre-line break-words text-[14px] leading-5">{r.detail}</p>}
      {r.status !== "open" && (
        <p className="t-sub mt-1">
          {r.resolution ? `${r.resolution}, ` : ""}
          {r.resolvedBy?.nickname ?? "탈퇴한 관리자"}
          {r.resolvedAt ? `, ${adminDateTime(r.resolvedAt)}` : ""}
        </p>
      )}
    </li>
  );
}

function TargetPreview({
  target,
  onHide,
  onUnhide,
  unhiding,
  onDeleteGroup,
  onDeleteEvent,
}: {
  target: AdminReportTargetDetail;
  onHide: (target: "groups" | "events", id: number) => void;
  onUnhide: (target: "groups" | "events", id: number) => void;
  unhiding: boolean;
  onDeleteGroup: (g: AdminGroupDetail | AdminGroup) => void;
  onDeleteEvent: (e: AdminEventDetail) => void;
}) {
  if (target.type === "group") {
    const g = target.group;
    return (
      <>
        <dl className="divide-y divide-line">
          <InfoRow label="팀">
            <Link href={`/admin/teams/${g.id}`} className="font-semibold underline underline-offset-2">
              {adminGroupName(g)} #{g.id}
            </Link>
          </InfoRow>
          <InfoRow label="상태">{g.hidden ? <StatusBadge tone="warn">숨김</StatusBadge> : <StatusBadge tone="on">정상</StatusBadge>}</InfoRow>
          <InfoRow label="규모">
            멤버 {g.memberCount}명, 일정 {g.eventCount}개
          </InfoRow>
          <InfoRow label="멤버">{g.members.map((m) => m.displayName ?? m.nickname).join(", ") || "-"}</InfoRow>
          <InfoRow label="만든 날">{adminDateTime(g.createdAt)}</InfoRow>
        </dl>
        {g.hidden && (
          <div className="mt-2">
            <HiddenBox hidden={g.hidden} />
          </div>
        )}
        <Actions hidden={Boolean(g.hidden)} unhiding={unhiding} onHide={() => onHide("groups", g.id)} onUnhide={() => onUnhide("groups", g.id)} onDelete={() => onDeleteGroup(g)} deleteLabel="팀 삭제" />
      </>
    );
  }
  if (target.type === "event") {
    const e = target.event;
    return (
      <>
        <dl className="divide-y divide-line">
          <InfoRow label="일정">
            <Link href={`/admin/events/${e.id}`} className="font-semibold underline underline-offset-2">
              {e.title} #{e.id}
            </Link>
          </InfoRow>
          <InfoRow label="상태">{e.hidden ? <StatusBadge tone="warn">숨김</StatusBadge> : <StatusBadge tone="on">정상</StatusBadge>}</InfoRow>
          <InfoRow label="팀">
            <Link href={`/admin/teams/${e.group.id}`} className="underline underline-offset-2">
              {adminGroupName(e.group)}
            </Link>
            {e.group.hidden && <span className="ml-1.5 text-[12px] font-bold text-danger">숨긴 팀</span>}
          </InfoRow>
          <InfoRow label="시작">
            {adminEventTime(e.startsAt, e.allDay)}
            {e.repeat && <span className="t-sub"> (반복)</span>}
          </InfoRow>
          <InfoRow label="만든 사람">{e.creator?.nickname ?? "탈퇴한 멤버"}</InfoRow>
          <InfoRow label="장소">{e.place ?? <span className="text-ink-2">없음</span>}</InfoRow>
          <InfoRow label="메모">{e.memo ? <span className="whitespace-pre-line">{e.memo}</span> : <span className="text-ink-2">없음</span>}</InfoRow>
        </dl>
        {e.hidden && (
          <div className="mt-2">
            <HiddenBox hidden={e.hidden} />
          </div>
        )}
        <Actions hidden={Boolean(e.hidden)} unhiding={unhiding} onHide={() => onHide("events", e.id)} onUnhide={() => onUnhide("events", e.id)} onDelete={() => onDeleteEvent(e)} deleteLabel="일정 삭제" />
      </>
    );
  }
  const { user, teams } = target;
  return (
    <>
      <dl className="divide-y divide-line">
        <InfoRow label="사용자">
          <Link href={`/admin/users/${user.id}`} className="font-semibold underline underline-offset-2">
            {user.nickname} #{user.id}
          </Link>
        </InfoRow>
        <InfoRow label="가입">{adminDateTime(user.createdAt)}</InfoRow>
        <InfoRow label="쓰는 곳">{adminPlatformLabels(user.platforms).join(", ")}</InfoRow>
      </dl>
      <p className="t-sub mt-2 border-t border-line pt-3">사용자를 정지하는 기능은 없어요. 필요하면 이 사람이 있는 팀을 숨겨 주세요</p>
      {teams.length === 0 ? (
        <p className="t-sub mt-2">속한 팀이 없어요</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {teams.map((t) => (
            <li key={t.id} className="flex min-h-12 items-center gap-2 py-2">
              <Link href={`/admin/teams/${t.id}`} className="min-w-0 flex-1 truncate text-[14px] font-semibold underline-offset-2 hover:underline">
                {t.name}
              </Link>
              <span className="t-sub shrink-0">멤버 {t.memberCount}명</span>
              {t.hidden ? (
                <Button variant="outline" size="sm" loading={unhiding} onClick={() => onUnhide("groups", t.id)}>
                  숨김 해제
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => onHide("groups", t.id)}>
                  팀 숨기기
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Actions({ hidden, unhiding, onHide, onUnhide, onDelete, deleteLabel }: { hidden: boolean; unhiding: boolean; onHide: () => void; onUnhide: () => void; onDelete: () => void; deleteLabel: string }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
      {hidden ? (
        <Button variant="outline" size="sm" loading={unhiding} onClick={onUnhide}>
          숨김 해제
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onHide}>
          숨기기
        </Button>
      )}
      <Button variant="danger" size="sm" className="ml-auto" onClick={onDelete}>
        {deleteLabel}
      </Button>
    </div>
  );
}
