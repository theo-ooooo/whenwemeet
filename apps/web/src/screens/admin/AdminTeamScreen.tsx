"use client";
// (#515) 관리자 팀 상세: 정보, 멤버, 최근 일정, 숨기기 / 숨김 해제 / 삭제(팀 이름 입력) (D-286)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { Button, ErrorState, InlineError, Skeleton } from "@/components/ui";
import {
  messageOf,
  useAdminGroup,
  useDeleteTarget,
  useHideTarget,
  useUnhideTarget,
} from "@/hooks";
import { adminDateTime, adminEventTime, adminGroupName } from "@/lib/admin";
import type { AdminGroupDetail } from "@/lib/types";
import { StatusBadge } from "./AdminMore";
import { HiddenBox, InfoRow } from "./HiddenBox";
import { DeleteTeamDialog, HideDialog } from "./ModerationDialogs";

export function AdminTeamScreen({ id }: { id: number }) {
  const router = useRouter();
  const q = useAdminGroup(id);
  const [dialog, setDialog] = useState<"hide" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hide = useHideTarget<AdminGroupDetail>("groups");
  const unhide = useUnhideTarget<AdminGroupDetail>("groups");
  const remove = useDeleteTarget("groups", { keepPendingAfterSuccess: true });

  if (q.error && !q.data)
    return (
      <ErrorState
        message={messageOf(q.error, "팀을 불러오지 못했어요")}
        onRetry={q.refetch}
      />
    );
  const g = q.data;
  if (!g) return <Skeleton className="h-[320px] w-full rounded-xl" />;

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
    router.push("/admin/teams");
  }

  return (
    <div>
      {/* (#528) 개인 달력은 이름이 모두 "내 달력" 이라 주인으로 부른다 */}
      <AdminTitle title={adminGroupName(g)} sub={`${g.type === "PERSONAL" ? "개인 달력" : "팀"} #${g.id}`} />
      {error && <InlineError className="mb-2">{error}</InlineError>}
      {/* 넓은 화면은 왼쪽 정보 카드, 오른쪽 멤버와 최근 일정 */}
      <div className="lg:grid lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <section className="rounded-xl bg-paper px-4 py-3 lg:sticky lg:top-7">
          <dl className="divide-y divide-line">
            <InfoRow label="종류">
              {g.type === "PERSONAL" ? "개인 달력" : "팀"}
            </InfoRow>
            <InfoRow label="상태">
              {g.hidden ? (
                <StatusBadge tone="warn">숨김</StatusBadge>
              ) : (
                <StatusBadge tone="on">정상</StatusBadge>
              )}
            </InfoRow>
            <InfoRow label="만든 날">{adminDateTime(g.createdAt)}</InfoRow>
            <InfoRow label="규모">
              멤버 {g.memberCount}명, 일정 {g.eventCount}개
            </InfoRow>
          </dl>
          {g.hidden && (
            <div className="mt-2 pb-1">
              <HiddenBox hidden={g.hidden} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            {g.hidden ? (
              <Button
                variant="outline"
                size="sm"
                loading={unhide.isPending}
                onClick={() => void onUnhide()}
              >
                숨김 해제
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog("hide")}
              >
                숨기기
              </Button>
            )}
            <Link
              href={`/admin/events?groupId=${g.id}`}
              className="hit inline-flex h-8 items-center rounded-sm px-3 text-[13px] font-bold text-ink-2 hover:text-ink"
            >
              이 팀 일정 전체
            </Link>
            <Button
              variant="danger"
              size="sm"
              className="ml-auto"
              onClick={() => setDialog("delete")}
            >
              팀 삭제
            </Button>
          </div>
        </section>

        <div className="mt-4 grid gap-4 fold:grid-cols-2 lg:mt-0">
          <section aria-labelledby="team-members">
            <h2
              id="team-members"
              className="mb-2 px-1 text-[13px] font-bold text-ink-2"
            >
              멤버 {g.members.length}명
            </h2>
            <ul className="divide-y divide-line rounded-xl bg-paper px-4">
              {g.members.map((m) => (
                <li key={m.userId}>
                  <Link
                    href={`/admin/users/${m.userId}`}
                    className="flex min-h-12 items-center gap-2 py-2.5 hover:brightness-95"
                  >
                    <b className="min-w-0 truncate text-[14px] font-semibold">
                      {m.displayName ?? m.nickname}
                    </b>
                    {m.displayName && (
                      <span className="t-sub truncate">({m.nickname})</span>
                    )}
                    <span className="t-sub ml-auto shrink-0">
                      {adminDateTime(m.joinedAt).slice(0, 10)} 합류
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="team-events">
            <h2
              id="team-events"
              className="mb-2 px-1 text-[13px] font-bold text-ink-2"
            >
              최근 일정
            </h2>
            {g.recentEvents.length === 0 ? (
              <p className="t-sub rounded-xl bg-paper px-4 py-4">
                일정이 없어요
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-xl bg-paper px-4">
                {g.recentEvents.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/admin/events/${e.id}`}
                      className="flex min-h-12 items-center gap-2 py-2.5 hover:brightness-95"
                    >
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[14px] font-semibold">
                          {e.title}
                        </b>
                        <span className="t-sub block">
                          {adminEventTime(e.startsAt, e.allDay)}
                        </span>
                      </span>
                      {e.hidden && <StatusBadge tone="warn">숨김</StatusBadge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <HideDialog
        open={dialog === "hide"}
        title="이 팀을 숨길까요?"
        body="멤버는 이 팀의 달력과 일정을 볼 수 없고 사유가 담긴 이용 제한 안내를 보게 돼요. 초대 링크도 막혀요"
        loading={hide.isPending}
        onConfirm={(reason) => void onHide(reason)}
        onCancel={() => setDialog(null)}
      />
      <DeleteTeamDialog
        open={dialog === "delete"}
        name={adminGroupName(g)}
        loading={remove.isPending}
        onConfirm={() => void onDelete()}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
