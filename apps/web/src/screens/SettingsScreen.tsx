"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { IconCheck } from "@/components/icons";
import { Avatar, Button, ConfirmDialog, ErrorState, MemberDot, Skeleton, inputClass } from "@/components/ui";
import { messageOf, useLeaveGroup, useRotateInviteCode, useUpdateGroup, useUpdateMembership } from "@/hooks";
import { forgetGroup } from "@/lib/group-cookie";
import { COLOR_NAMES, memberColor, ON_MEMBER_COLOR, PICKABLE_COLORS } from "@/lib/colors";
import type { GroupDetail } from "@/lib/types";

export function SettingsScreen({ groupId, openInvite }: { groupId: number; openInvite: boolean }) {
  const { group, error, refresh, setGroup } = useGroupContext();

  if (error && !group) {
    return (
      <div className="pt-6">
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <h1 className="t-title mt-2 lg:mt-0">팀 설정</h1>
      {group ? (
        <>
          <NameSection group={group} onSaved={setGroup} />
          {group.type === "TEAM" ? (
            <InviteSection group={group} onSaved={setGroup} open={openInvite} />
          ) : (
            <section className="rounded-xl bg-paper px-3.5 py-3.5">
              <p className="text-[14px] leading-5 text-soft">
                개인 달력은 나만 볼 수 있어요. 여럿이 쓰려면 새 팀을 만들어 보세요
              </p>
              <Link href="/groups/new" className="mt-3 block">
                <Button full tabIndex={-1}>
                  새 팀 만들기
                </Button>
              </Link>
            </section>
          )}
          <MembersSection group={group} />
          <MeSection group={group} onSaved={setGroup} />
          {group.type === "TEAM" && <LeaveSection group={group} groupId={groupId} />}
        </>
      ) : (
        <div className="space-y-2" aria-busy="true" aria-label="불러오는 중">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[13px] font-bold leading-5">{children}</h2>;
}

/* 팀 이름 */
function NameSection({ group, onSaved }: { group: GroupDetail; onSaved: (g: GroupDetail) => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const { mutate, isPending: saving } = useUpdateGroup(group.id);
  const valid = name.trim().length >= 1 && name.trim().length <= 30;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const r = await mutate({ name: name.trim() });
    if (!r.ok) {
      toast.show(messageOf(r.error, "저장하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    onSaved(r.data);
    setEditing(false);
  }

  return (
    <section className="rounded-xl bg-paper px-3.5 py-3.5">
      <SectionTitle>팀 이름</SectionTitle>
      {editing ? (
        <form onSubmit={save} className="mt-2 flex gap-2">
          <input
            aria-label="팀 이름"
            className={inputClass}
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={!valid} loading={saving}>
            저장
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditing(false);
              setName(group.name);
            }}
          >
            취소
          </Button>
        </form>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="truncate text-[18px] font-bold tracking-[-0.02em]">{group.name}</p>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            이름 바꾸기
          </Button>
        </div>
      )}
    </section>
  );
}

/* 초대 */
function InviteSection({ group, onSaved, open }: { group: GroupDetail; onSaved: (g: GroupDetail) => void; open: boolean }) {
  const toast = useToast();
  const ref = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState(false);
  const { mutate: rotateCode, isPending: rotating } = useRotateInviteCode(group.id);

  useEffect(() => {
    if (open) {
      ref.current?.scrollIntoView({ block: "center" });
      ref.current?.focus();
    }
  }, [open]);

  const url = group.inviteUrl ?? "";
  const text = `'${group.name}' 달력에 초대할게요. 링크를 열고 카카오로 로그인하면 바로 합류돼요\n${url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.show("초대 링크를 복사했어요");
    } catch {
      toast.show("복사하지 못했어요. 코드를 직접 알려 주세요");
    }
  }

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "언제볼까 초대", text, url });
      } catch {}
      return;
    }
    await copy();
  }

  async function rotate() {
    const r = await rotateCode();
    if (!r.ok) {
      toast.show(messageOf(r.error, "재발급하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    onSaved({ ...group, inviteCode: r.data.inviteCode, inviteUrl: r.data.inviteUrl });
    toast.show("새 초대 코드를 만들었어요");
    setConfirm(false);
  }

  return (
    <section
      ref={ref}
      tabIndex={-1}
      className={`rounded-xl bg-paper px-3.5 py-3.5 outline-none ${open ? "ring-2 ring-ink" : ""}`}
    >
      <SectionTitle>초대</SectionTitle>
      <p className="mt-0.5 text-[13px] leading-5 text-soft">링크를 열거나 코드를 입력하면 이 달력에 합류해요</p>
      <p className="mt-3 rounded-sm bg-surface py-3 text-center text-[28px] font-bold leading-9 tracking-[0.18em] tabular-nums" aria-label={`초대 코드 ${group.inviteCode?.split("").join(" ")}`}>
        {group.inviteCode}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={copy}>
          링크 복사
        </Button>
        <Button onClick={share}>카카오톡으로 공유</Button>
      </div>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="mt-2 w-full rounded-sm py-2 text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
      >
        코드 재발급
      </button>
      <ConfirmDialog
        open={confirm}
        title="초대 코드를 다시 만들까요?"
        body="이전 링크는 더 이상 쓸 수 없어요"
        confirmLabel="재발급"
        loading={rotating}
        onConfirm={rotate}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}

/* 멤버 */
function MembersSection({ group }: { group: GroupDetail }) {
  return (
    <section className="rounded-xl bg-paper px-3.5 py-3.5">
      <SectionTitle>멤버 {group.members.length}명</SectionTitle>
      <ul className="mt-1 divide-y divide-line">
        {group.members.map((m) => {
          const isMe = m.userId !== null && m.userId === group.me.userId;
          return (
            <li key={m.userId ?? m.displayName} className="flex min-h-11 items-center gap-2.5 py-1.5">
              <Avatar member={m} size={28} />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <MemberDot color={m.color} size={8} />
                <span className="truncate text-[15px] font-semibold">{m.displayName}</span>
                {isMe && <span className="text-[12px] text-ink-2">(나)</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* 내 표시 */
function MeSection({ group, onSaved }: { group: GroupDetail; onSaved: (g: GroupDetail) => void }) {
  const toast = useToast();
  const [color, setColor] = useState(group.me.color);
  const [displayName, setDisplayName] = useState(group.me.displayName);
  const { mutate, isPending: saving } = useUpdateMembership(group.id);
  const palette = Array.from(new Set<string>([...PICKABLE_COLORS, group.me.color.toUpperCase()]));
  const dirty = color !== group.me.color || displayName.trim() !== group.me.displayName;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await mutate({ color, displayName: displayName.trim() === "" ? null : displayName.trim() });
    if (!r.ok) {
      toast.show(messageOf(r.error, "저장하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    const me = r.data;
    onSaved({
      ...group,
      me,
      members: group.members.map((m) => (m.userId === me.userId ? { ...m, ...me } : m)),
    });
    setDisplayName(me.displayName);
    toast.show("내 표시를 저장했어요");
  }

  return (
    <section className="rounded-xl bg-paper px-3.5 py-3.5">
      <SectionTitle>이 팀에서 내 표시</SectionTitle>
      <form onSubmit={save}>
        <fieldset className="mt-2">
          <legend className="sr-only">내 색</legend>
          <div className="flex flex-wrap gap-2">
            {palette.map((c) => {
              const selected = c.toUpperCase() === color.toUpperCase();
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={COLOR_NAMES[PICKABLE_COLORS.indexOf(c as (typeof PICKABLE_COLORS)[number])] ?? "지금 색"}
                  onClick={() => setColor(c)}
                  className="flex size-8 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: memberColor(c),
                    boxShadow: selected ? `0 0 0 2px var(--tile), 0 0 0 4px ${memberColor(c)}` : undefined,
                  }}
                >
                  {selected && <IconCheck size={16} strokeWidth={2.6} style={{ color: ON_MEMBER_COLOR }} />}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label htmlFor="me-name" className="mt-3.5 block text-[12px] font-medium text-ink-2">
          표시 이름
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="me-name"
            className={inputClass}
            value={displayName}
            maxLength={20}
            placeholder="비우면 내 닉네임"
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button type="submit" disabled={!dirty} loading={saving}>
            저장
          </Button>
        </div>
      </form>
    </section>
  );
}

/* 나가기 */
function LeaveSection({ group, groupId }: { group: GroupDetail; groupId: number }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  // 성공 뒤 홈으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const { mutate, isPending: leaving } = useLeaveGroup(groupId, { keepPendingAfterSuccess: true });
  const last = group.members.length <= 1;

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
    <section className="pt-2">
      <Button variant="tile" size="lg" full onClick={() => setConfirm(true)} className="text-danger!">
        팀 나가기
      </Button>
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
    </section>
  );
}
