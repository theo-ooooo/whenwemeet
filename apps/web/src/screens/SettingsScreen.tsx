"use client";
import Link from "next/link";
import { IMPORT_PATH } from "@/lib/routes";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useGroupContext } from "@/components/AppShell";
import { CalendarFeedSection } from "@/components/CalendarFeedSection";
import { useToast } from "@/components/Toast";
import { IconCheck, IconChevronRight, KakaoSymbol } from "@/components/icons";
import { NameEditRow } from "@/components/NameEditRow";
import { Avatar, Button, ConfirmDialog, ErrorState, Skeleton, Toggle } from "@/components/ui";
import { messageOf, useLeaveGroup, useRotateInviteCode, useUpdateGroup, useUpdateMembership } from "@/hooks";
import { isInApp, postToApp } from "@/lib/app-bridge";
import { forgetGroup } from "@/lib/group-cookie";
import { inviteShare } from "@/lib/invite-share";
import { inviteKakaoFeed, preloadKakaoSdk, shareKakaoFeed } from "@/lib/kakao-share";
import { COLOR_NAMES, memberColor, ON_MEMBER_COLOR, PICKABLE_COLORS } from "@/lib/colors";
import type { GroupDetail } from "@/lib/types";

export function SettingsScreen({ openInvite }: { openInvite: boolean }) {
  const { groupId, group, error, refresh, setGroup } = useGroupContext();

  if (error && !group) {
    return (
      <div className="pt-6">
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex h-10 items-center">
        <h1 className="t-title">팀 설정</h1>
      </div>
      {group ? (
        // 본문 폭 main-lg(≥696, #323): 왼쪽 팀(이름, 초대, 멤버) | 오른쪽 이 팀에서 나(내 표시, 알림, 다른 캘린더 앱에서 보기, 나가기). 그 아래는 1단 (#244)
        <div className="space-y-2 main-lg:grid main-lg:grid-cols-2 main-lg:items-start main-lg:gap-3 main-lg:space-y-0">
          <div className="space-y-2">
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
          </div>
          <div className="space-y-2">
            <MeSection group={group} onSaved={setGroup} />
            {/* (#188) 이 팀 알림. 옛 API(notify 없음)에서는 줄을 두지 않는다 */}
            {group.me.notify !== undefined && <NotifySection group={group} onSaved={setGroup} />}
            {/* (#305) 이 팀 달력에 내 생일 보이기. 옛 API(showBirthday 없음)에서는 줄을 두지 않는다 */}
            {group.me.showBirthday !== undefined && <BirthdaySection group={group} onSaved={setGroup} />}
            {/* (#193) 외부 캘린더 구독 주소. 개인 달력에도 같은 칸 */}
            <CalendarFeedSection key={group.id} groupId={group.id} personal={group.type === "PERSONAL"} />
            <ImportSection personal={group.type === "PERSONAL"} />
            {group.type === "TEAM" && <LeaveSection group={group} groupId={groupId} />}
          </div>
        </div>
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

/* 팀 이름 (#171 이름 바꾸기 공통 모양) */
function NameSection({ group, onSaved }: { group: GroupDetail; onSaved: (g: GroupDetail) => void }) {
  const { mutate, isPending: saving } = useUpdateGroup(group.id);

  async function save(name: string): Promise<string | null> {
    const r = await mutate({ name });
    if (!r.ok) return messageOf(r.error, "저장하지 못했어요. 다시 시도해 주세요");
    onSaved(r.data);
    return null;
  }

  return (
    <section className="rounded-xl bg-paper px-3.5 py-3.5">
      <NameEditRow label="팀 이름" value={group.name} max={30} saving={saving} onSave={save} />
    </section>
  );
}

/* 초대 */
const noopSubscribe = () => () => {};
const textButton = "hit rounded-sm px-1 py-2 text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink";
/** OS 공유 시트를 띄울 수 있는지: 앱 셸(share 브리지) 또는 Web Share 가 있는 브라우저. 없으면(PC 대부분) "다른 앱으로 보내기" 를 숨긴다 */
const canUseOsShare = () => isInApp() || typeof navigator.share === "function";

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

  // (#195) 카카오 JS SDK 는 이 칸이 그려질 때만 받는다 (다른 화면에는 싣지 않는다)
  useEffect(() => preloadKakaoSdk(), []);

  // (#196) 주소는 내 표식(?by=)이 붙은 inviteShareUrl. 문구와 함께 lib/invite-share.ts 한 곳에서 (D-159)
  const { url, message, text, title } = inviteShare(group);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.show("초대 링크를 복사했어요");
    } catch {
      toast.show("복사하지 못했어요. 코드를 직접 알려 주세요");
    }
  }

  async function share() {
    // 앱 안이면 OS 공유 시트 (Android WebView 에는 Web Share 가 없다, 앱.md 4.3). 링크는 셸이 붙이므로 본문에서 뺀다
    if (postToApp({ type: "share", url, text: message, title })) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
      } catch {}
      return;
    }
    await copy();
  }

  // (#195) 카카오톡 공유 카드. 키 없음, SDK 실패, 카카오 공유를 모르는 옛 앱이면 지금 동작(OS 공유 시트, 복사)으로 (D-168, D-169)
  const [kakaoBusy, setKakaoBusy] = useState(false);
  async function shareKakao() {
    const feed = inviteKakaoFeed(group);
    setKakaoBusy(true);
    try {
      if (feed && (await shareKakaoFeed(feed, message))) return;
      await share();
    } finally {
      setKakaoBusy(false);
    }
  }
  const canOsShare = useSyncExternalStore(noopSubscribe, canUseOsShare, () => false);

  async function rotate() {
    const r = await rotateCode();
    if (!r.ok) {
      toast.show(messageOf(r.error, "재발급하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    onSaved({ ...group, inviteCode: r.data.inviteCode, inviteUrl: r.data.inviteUrl, inviteShareUrl: r.data.inviteShareUrl });
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
        {/* 카카오 공유 버튼 가이드: 바탕 #FEE500, 말풍선 심볼 #000, 글자 #000 85% (UIUX 1차 L13) */}
        <Button variant="kakao" onClick={shareKakao} loading={kakaoBusy}>
          {!kakaoBusy && <KakaoSymbol />}
          카카오톡으로 공유
        </Button>
      </div>
      {/* 글자 버튼 줄: OS 공유 시트(문자, 다른 메신저)와 코드 재발급 (#195). Web Share 가 없는 PC 는 재발급만 */}
      <div className="mt-2 flex justify-center gap-4">
        {canOsShare && (
          <button type="button" onClick={share} className={textButton}>
            다른 앱으로 보내기
          </button>
        )}
        <button type="button" onClick={() => setConfirm(true)} className={textButton}>
          코드 재발급
        </button>
      </div>
      <ConfirmDialog
        open={confirm}
        title="초대 코드를 다시 만들까요?"
        body="이전 초대 링크와 일정 공유 링크는 더 이상 쓸 수 없어요"
        confirmLabel="재발급"
        neutral
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
              {/* 멤버 색은 아바타가 진다 (이니셜 바탕, 사진 링). 따로 점을 두지 않는다 (#168) */}
              <Avatar member={m} color={m.color} size={28} />
              <span className="flex min-w-0 flex-1 items-center gap-2">
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

/* 내 표시: 색은 누르면 바로 저장, 표시 이름은 이름 바꾸기 공통 모양 (#171) */
function MeSection({ group, onSaved }: { group: GroupDetail; onSaved: (g: GroupDetail) => void }) {
  const toast = useToast();
  const { mutate, isPending } = useUpdateMembership(group.id);
  const [pending, setPending] = useState<"color" | "name" | null>(null);
  const color = group.me.color;
  const palette = Array.from(new Set<string>([...PICKABLE_COLORS, color.toUpperCase()]));

  async function update(input: { color: string; displayName: string | null }, what: "color" | "name") {
    setPending(what);
    const r = await mutate(input);
    setPending(null);
    if (!r.ok) return messageOf(r.error, "저장하지 못했어요. 다시 시도해 주세요");
    const me = r.data;
    onSaved({
      ...group,
      me,
      members: group.members.map((m) => (m.userId === me.userId ? { ...m, ...me } : m)),
    });
    return null;
  }

  async function pickColor(c: string) {
    if (isPending || c.toUpperCase() === color.toUpperCase()) return;
    const failed = await update({ color: c, displayName: group.me.displayName }, "color");
    toast.show(failed ?? "내 색을 바꿨어요");
  }

  return (
    <section className="rounded-xl bg-paper px-3.5 py-3.5">
      <SectionTitle>이 팀에서 내 표시</SectionTitle>
      <fieldset className="mt-2" aria-busy={pending === "color" || undefined}>
        <legend className="sr-only">내 색</legend>
        <div className="flex flex-wrap gap-3">
          {palette.map((c) => {
            const selected = c.toUpperCase() === color.toUpperCase();
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={COLOR_NAMES[PICKABLE_COLORS.indexOf(c as (typeof PICKABLE_COLORS)[number])] ?? "지금 색"}
                onClick={() => void pickColor(c)}
                disabled={pending === "color"}
                className="hit flex size-8 items-center justify-center rounded-full disabled:cursor-wait"
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
      <div className="mt-3.5">
        <NameEditRow
          label="표시 이름"
          value={group.me.displayName}
          max={20}
          allowEmpty
          placeholder="비우면 내 닉네임"
          saving={pending === "name"}
          onSave={(next) => update({ color, displayName: next === "" ? null : next }, "name")}
        />
      </div>
    </section>
  );
}

/* (#188) 이 팀 알림 받기 (푸시-알림.md 8장). 누르면 바로 저장, 실패하면 되돌리고 토스트 */
function NotifySection({ group, onSaved }: { group: GroupDetail; onSaved: (g: GroupDetail) => void }) {
  const toast = useToast();
  const { mutate, isPending } = useUpdateMembership(group.id);
  const on = group.me.notify !== false;

  async function change(next: boolean) {
    if (isPending) return;
    const before = group;
    onSaved({ ...group, me: { ...group.me, notify: next } });
    const r = await mutate({ notify: next });
    if (!r.ok) {
      onSaved(before);
      toast.show(messageOf(r.error, "알림 설정을 바꾸지 못했어요. 다시 시도해 주세요"));
      return;
    }
    onSaved({ ...before, me: { ...before.me, ...r.data } });
  }

  return (
    <section className="rounded-xl bg-paper px-3.5 py-2">
      <Toggle checked={on} onChange={(v) => void change(v)} label="이 팀 알림 받기" description="끄면 이 팀의 알림이 모두 오지 않아요" />
    </section>
  );
}

/* (#305) 이 팀 달력에 내 생일 보이기 (기본 켬, D-225). 누르면 바로 저장, 실패하면 되돌리고 토스트. 생일은 내 정보에서 넣는다 */
function BirthdaySection({ group, onSaved }: { group: GroupDetail; onSaved: (g: GroupDetail) => void }) {
  const toast = useToast();
  const { mutate, isPending } = useUpdateMembership(group.id);
  const on = group.me.showBirthday !== false;
  const personal = group.type === "PERSONAL";

  async function change(next: boolean) {
    if (isPending) return;
    const before = group;
    onSaved({ ...group, me: { ...group.me, showBirthday: next } });
    const r = await mutate({ showBirthday: next });
    if (!r.ok) {
      onSaved(before);
      toast.show(messageOf(r.error, "생일 보이기를 바꾸지 못했어요. 다시 시도해 주세요"));
      return;
    }
    onSaved({ ...before, me: { ...before.me, ...r.data } });
  }

  return (
    <section className="rounded-xl bg-paper px-3.5 py-2">
      <Toggle
        checked={on}
        onChange={(v) => void change(v)}
        label={personal ? "내 달력에 내 생일 보이기" : "이 팀 달력에 내 생일 보이기"}
        description={personal ? "생일은 내 정보에서 넣을 수 있어요" : "끄면 이 팀 멤버에게 내 생일이 보이지 않아요. 생일은 내 정보에서 넣어요"}
      />
    </section>
  );
}

/* (#279) 일정 가져오기 (.ics). 개인 달력에도 같은 줄 */
function ImportSection({ personal }: { personal: boolean }) {
  return (
    <section className="rounded-xl bg-paper px-3.5 py-1">
      <Link href={IMPORT_PATH} className="flex min-h-12 items-center gap-3 py-1.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold leading-5">일정 가져오기</span>
          <span className="t-sub block">
            {personal ? "다른 캘린더의 .ics 파일로 내 일정을 옮겨요" : "다른 캘린더의 .ics 파일로 일정을 한 번에 넣어요"}
          </span>
        </span>
        <IconChevronRight size={18} className="shrink-0 text-ink-2" />
      </Link>
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
