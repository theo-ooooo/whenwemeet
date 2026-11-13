"use client";
// 팀 설정 (#378, 나머지 화면 점검 3). 칸 9개가 세로로 길게 이어지던 것을 묶음 셋으로 나눈다:
//   "팀"   팀 이름 줄(→ 이름 시트), 초대하기 줄(→ 코드, 링크 복사, 카카오톡 공유 시트), 멤버
//   "나"   내 색 줄 "● 블루 ›"(→ 색 시트), 표시 이름 줄(→ 이름 시트), 이 팀 알림 토글, 생일 보이기 토글
//   "연결" 다른 캘린더 앱에서 보기 줄(→ 연결 주소 시트, #193), 일정 가져오기(#279)
//   맨 아래 빨간 글자 "팀 나가기"(확인 창). "바꾸기" 버튼은 두지 않고 줄을 누른다 (디자인규칙.md 8-0 3)
// `?invite=1` 이면 초대 시트를, (#278) `?feed=1` 이면 연결 주소 시트를 연 채로 시작한다
import { IMPORT_PATH } from "@/lib/routes";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useGroupContext } from "@/components/AppShell";
import { CalendarFeedSection } from "@/components/CalendarFeedSection";
import { NameSheet } from "@/components/NameSheet";
import { useToast } from "@/components/Toast";
import { IconCheck, KakaoSymbol } from "@/components/icons";
import { Avatar, Button, ConfirmDialog, ErrorState, MemberDot, RowButton, RowGroup, RowLink, Sheet, Skeleton, ToggleRow } from "@/components/ui";
import { messageOf, useLeaveGroup, useRotateInviteCode, useUpdateGroup, useUpdateMembership } from "@/hooks";
import { isInApp, postToApp } from "@/lib/app-bridge";
import { FEED_COPY } from "@/lib/calendar-feed";
import { forgetGroup } from "@/lib/group-cookie";
import { inviteShare } from "@/lib/invite-share";
import { inviteKakaoFeed, preloadKakaoSdk, shareKakaoFeed } from "@/lib/kakao-share";
import { COLOR_NAMES, eventColorName, memberColor, ON_MEMBER_COLOR, PICKABLE_COLORS } from "@/lib/colors";
import type { GroupDetail } from "@/lib/types";

type SheetKind = "name" | "invite" | "color" | "display" | "feed";

export function SettingsScreen({ openInvite, showFeed = false }: { openInvite: boolean; showFeed?: boolean }) {
  const { groupId, group, error, refresh, setGroup } = useGroupContext();
  // 주소로 연 시트(?invite=1, ?feed=1)는 팀을 받은 뒤 그린다
  const [sheet, setSheet] = useState<SheetKind | null>(openInvite ? "invite" : showFeed ? "feed" : null);
  const close = () => setSheet(null);

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
        // 본문 폭 main-lg(≥696, #323): 왼쪽 "팀" | 오른쪽 "나", "연결", 나가기 (#244)
        <div className="space-y-5 main-lg:grid main-lg:grid-cols-2 main-lg:items-start main-lg:gap-3 main-lg:space-y-0">
          <TeamGroup group={group} onOpen={setSheet} />
          <div className="space-y-5">
            <MeGroup group={group} onSaved={setGroup} onOpen={setSheet} />
            <RowGroup title="연결">
              <RowButton label={FEED_COPY.title} value="" aria-haspopup="dialog" onClick={() => setSheet("feed")} />
              <RowLink href={IMPORT_PATH} label="일정 가져오기" value=".ics 파일" />
            </RowGroup>
            {group.type === "TEAM" && <LeaveRow group={group} groupId={groupId} />}
          </div>
          <NameSheetFor group={group} open={sheet === "name"} onClose={close} onSaved={setGroup} />
          <DisplayNameSheet group={group} open={sheet === "display"} onClose={close} onSaved={setGroup} />
          <ColorSheet group={group} open={sheet === "color"} onClose={close} onSaved={setGroup} />
          {group.type === "TEAM" && <InviteSheet group={group} open={sheet === "invite"} onClose={close} onSaved={setGroup} />}
          <Sheet open={sheet === "feed"} onClose={close} title={FEED_COPY.title}>
            <CalendarFeedSection key={group.id} groupId={group.id} personal={group.type === "PERSONAL"} bare />
          </Sheet>
        </div>
      ) : (
        <div className="space-y-2" aria-busy="true" aria-label="불러오는 중">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}

/* "팀" 묶음: 팀 이름, 초대하기, 멤버. 개인 달력은 이름과 새 팀 만들기 */
function TeamGroup({ group, onOpen }: { group: GroupDetail; onOpen: (k: SheetKind) => void }) {
  if (group.type !== "TEAM") {
    return (
      <RowGroup title="달력" hint="개인 달력은 나만 볼 수 있어요. 여럿이 쓰려면 새 팀을 만들어 보세요">
        <RowButton label="이름" value={group.name} aria-haspopup="dialog" onClick={() => onOpen("name")} />
        <RowLink href="/groups/new" label="새 팀 만들기" value="" />
      </RowGroup>
    );
  }
  return (
    <RowGroup title="팀">
      <RowButton label="팀 이름" value={group.name} aria-haspopup="dialog" onClick={() => onOpen("name")} />
      <RowButton label="초대하기" value={group.inviteCode} aria-haspopup="dialog" onClick={() => onOpen("invite")} />
      <div>
        <p className="pt-2.5 text-[12px] font-medium leading-4 text-ink-2">멤버 {group.members.length}명</p>
        <ul>
          {group.members.map((m) => {
            const isMe = m.userId !== null && m.userId === group.me.userId;
            return (
              <li key={m.userId ?? m.displayName} className="flex min-h-11 items-center gap-2.5 py-1">
                {/* 멤버 색은 아바타가 진다 (이니셜 바탕, 사진 링). 따로 점을 두지 않는다 (#168) */}
                <Avatar member={m} color={m.color} size={28} />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-[14px] font-semibold">{m.displayName}</span>
                  {isMe && <span className="text-[12px] text-ink-2">(나)</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </RowGroup>
  );
}

/* 팀 이름 시트 */
function NameSheetFor({ group, open, onClose, onSaved }: { group: GroupDetail; open: boolean; onClose: () => void; onSaved: (g: GroupDetail) => void }) {
  const { mutate, isPending: saving } = useUpdateGroup(group.id);
  const label = group.type === "TEAM" ? "팀 이름" : "이름";
  async function save(name: string): Promise<string | null> {
    const r = await mutate({ name });
    if (!r.ok) return messageOf(r.error, "저장하지 못했어요. 다시 시도해 주세요");
    onSaved(r.data);
    return null;
  }
  return <NameSheet open={open} onClose={onClose} title={label} label={label} value={group.name} max={30} saving={saving} onSave={save} />;
}

/* 초대 */
const noopSubscribe = () => () => {};
const textButton = "hit rounded-sm px-1 py-2 text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink";
/** OS 공유 시트를 띄울 수 있는지: 앱 셸(share 브리지) 또는 Web Share 가 있는 브라우저. 없으면(PC 대부분) "다른 앱으로 보내기" 를 숨긴다 */
const canUseOsShare = () => isInApp() || typeof navigator.share === "function";

/** 초대하기 시트: 코드, 링크 복사, 카카오톡 공유, 다른 앱으로 보내기, 코드 재발급 (#195, #196) */
function InviteSheet({ group, open, onClose, onSaved }: { group: GroupDetail; open: boolean; onClose: () => void; onSaved: (g: GroupDetail) => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const { mutate: rotateCode, isPending: rotating } = useRotateInviteCode(group.id);

  // (#195) 카카오 JS SDK 는 팀 설정을 열 때 미리 받는다 (다른 화면에는 싣지 않는다)
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
    <>
      <Sheet open={open} onClose={onClose} title="초대하기">
        <div className="pb-1">
          <p className="text-[13px] leading-5 text-soft">링크를 열거나 코드를 입력하면 이 달력에 합류해요</p>
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
        </div>
      </Sheet>
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
    </>
  );
}

/** 내 표시 저장 (색, 표시 이름, 알림, 생일 보이기). 성공하면 팀 정보의 me 와 멤버 줄을 같이 고친다 */
function useMembershipSave(group: GroupDetail, onSaved: (g: GroupDetail) => void) {
  const { mutate, isPending } = useUpdateMembership(group.id);
  async function save(input: Parameters<typeof mutate>[0]): Promise<string | null> {
    const r = await mutate(input);
    if (!r.ok) return messageOf(r.error, "저장하지 못했어요. 다시 시도해 주세요");
    const me = { ...group.me, ...r.data };
    onSaved({ ...group, me, members: group.members.map((m) => (m.userId === me.userId ? { ...m, ...me } : m)) });
    return null;
  }
  return { save, isPending };
}

/* "나" 묶음: 내 색, 표시 이름, 이 팀 알림, 생일 보이기 */
function MeGroup({ group, onSaved, onOpen }: { group: GroupDetail; onSaved: (g: GroupDetail) => void; onOpen: (k: SheetKind) => void }) {
  const toast = useToast();
  const { mutate, isPending } = useUpdateMembership(group.id);
  const personal = group.type === "PERSONAL";

  // (#188) 알림, (#305) 생일 보이기: 누르면 바로 바꿔 보이고 저장, 실패하면 되돌리고 토스트
  async function toggle(input: { notify: boolean } | { showBirthday: boolean }, failText: string) {
    if (isPending) return;
    const before = group;
    onSaved({ ...group, me: { ...group.me, ...input } });
    const r = await mutate(input);
    if (!r.ok) {
      onSaved(before);
      toast.show(messageOf(r.error, failText));
      return;
    }
    onSaved({ ...before, me: { ...before.me, ...r.data } });
  }

  return (
    <RowGroup title="나">
      <RowButton
        label="내 색"
        aria-haspopup="dialog"
        onClick={() => onOpen("color")}
        value={
          <span className="inline-flex items-center gap-1.5">
            <MemberDot color={group.me.color} size={10} />
            {eventColorName(group.me.color)}
          </span>
        }
      />
      <RowButton label="표시 이름" value={group.me.displayName} aria-haspopup="dialog" onClick={() => onOpen("display")} />
      {/* (#188) 이 팀 알림. 옛 API(notify 없음)에서는 줄을 두지 않는다 */}
      {group.me.notify !== undefined && (
        <ToggleRow
          label={personal ? "알림 받기" : "이 팀 알림 받기"}
          description={personal ? "끄면 이 달력 알림이 오지 않아요" : "끄면 이 팀 알림이 모두 오지 않아요"}
          checked={group.me.notify !== false}
          onChange={(v) => void toggle({ notify: v }, "알림 설정을 바꾸지 못했어요. 다시 시도해 주세요")}
        />
      )}
      {/* (#305) 이 팀 달력에 내 생일 보이기(기본 켬, D-231). 생일은 내 정보에서 넣는다. 옛 API(showBirthday 없음)에서는 줄을 두지 않는다 */}
      {group.me.showBirthday !== undefined && (
        <ToggleRow
          label={personal ? "내 달력에 내 생일 보이기" : "이 팀 달력에 내 생일 보이기"}
          description={personal ? "생일은 내 정보에서 넣어요" : "끄면 멤버에게 내 생일이 안 보여요"}
          checked={group.me.showBirthday !== false}
          onChange={(v) => void toggle({ showBirthday: v }, "생일 보이기를 바꾸지 못했어요. 다시 시도해 주세요")}
        />
      )}
    </RowGroup>
  );
}

/* 표시 이름 시트 (#171 이름 바꾸기 공통, 비우면 닉네임) */
function DisplayNameSheet({ group, open, onClose, onSaved }: { group: GroupDetail; open: boolean; onClose: () => void; onSaved: (g: GroupDetail) => void }) {
  const { save, isPending } = useMembershipSave(group, onSaved);
  return (
    <NameSheet
      open={open}
      onClose={onClose}
      title="표시 이름"
      label="표시 이름"
      value={group.me.displayName}
      max={20}
      allowEmpty
      placeholder="비우면 내 닉네임"
      saving={isPending}
      onSave={(next) => save({ color: group.me.color, displayName: next === "" ? null : next })}
    />
  );
}

/* 내 색 시트: 팔레트 8색(+ 팔레트 밖 지금 색). 누르면 바로 저장하고 닫는다 */
function ColorSheet({ group, open, onClose, onSaved }: { group: GroupDetail; open: boolean; onClose: () => void; onSaved: (g: GroupDetail) => void }) {
  const toast = useToast();
  const { save, isPending } = useMembershipSave(group, onSaved);
  const color = group.me.color;
  const palette = Array.from(new Set<string>([...PICKABLE_COLORS, color.toUpperCase()]));

  async function pick(c: string) {
    if (isPending) return;
    if (c.toUpperCase() === color.toUpperCase()) {
      onClose();
      return;
    }
    const failed = await save({ color: c, displayName: group.me.displayName });
    toast.show(failed ?? "내 색을 바꿨어요");
    if (!failed) onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="내 색">
      <p className="t-sub">이 팀 달력에서 내 일정과 이름에 쓰여요</p>
      <div role="radiogroup" aria-label="내 색" aria-busy={isPending || undefined} className="mt-3 flex flex-wrap gap-3 pb-2">
        {palette.map((c) => {
          const selected = c.toUpperCase() === color.toUpperCase();
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={COLOR_NAMES[PICKABLE_COLORS.indexOf(c as (typeof PICKABLE_COLORS)[number])] ?? "지금 색"}
              onClick={() => void pick(c)}
              disabled={isPending}
              className="hit flex size-10 items-center justify-center rounded-full disabled:cursor-wait"
              style={{
                backgroundColor: memberColor(c),
                boxShadow: selected ? `0 0 0 2px var(--tile), 0 0 0 4px ${memberColor(c)}` : undefined,
              }}
            >
              {selected && <IconCheck size={18} strokeWidth={2.6} style={{ color: ON_MEMBER_COLOR }} />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/* 나가기: 맨 아래 빨간 글자 줄. 확인 창 */
function LeaveRow({ group, groupId }: { group: GroupDetail; groupId: number }) {
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
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="flex h-11 w-full items-center justify-center rounded-lg bg-paper text-[14px] font-semibold text-danger hover:brightness-95"
      >
        팀 나가기
      </button>
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
