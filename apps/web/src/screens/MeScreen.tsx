"use client";
// 내 정보 (#378, 나머지 화면 점검 4). 팀 화면 뼈대(AppShell) 안이라 위 앱 머리줄과 독이 있다.
// 머리줄 "‹ 내 정보"(넓은 화면은 사이드바가 있어 ‹ 없음) → 프로필 칸(누르면 사진과 닉네임 시트, "바꾸기" 버튼 없음)
// → 줄 묶음(내 생일, 처음 여는 달력, 알림, 로그인 방법) → 화면 테마 → 지도 → 내 팀 → 로그아웃, 약관, 탈퇴
import Link from "next/link";
import { CALENDAR_PATH, withTeam } from "@/lib/routes";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { IconBell, IconCalendar, IconCamera, IconKey, IconChevronLeft, IconChevronRight, IconDevice, IconMegaphone, IconMoon, IconPlus, IconShield, IconSun } from "@/components/icons";
import { BirthdayRow } from "@/components/BirthdayRow";
import { NameForm } from "@/components/NameSheet";
import { ScreenHeader } from "@/components/ScreenHeader";
import { StartCalendarRow } from "@/components/StartCalendarRow";
import { useDeviceCalendarSupported } from "@/screens/DeviceCalendarScreen";
import { useToast } from "@/components/Toast";
import { Avatar, Button, ErrorState, InlineError, RowGroup, RowLink, Segmented, Sheet, Skeleton, Spinner, ToggleRow, inputClass } from "@/components/ui";
import { useGroupContext } from "@/components/AppShell";
import { messageOf, useDeleteAvatar, useDeleteMe, useGroups, useMe, useUpdateLunarDisplay, useUpdateMe, useUploadAvatar, type ApiFailure } from "@/hooks";
import { postToApp } from "@/lib/app-bridge";
import { forgetGroup } from "@/lib/group-cookie";
import { shrinkImage } from "@/lib/image";
import { forgetPushToken, storedPushToken } from "@/lib/push";
import { usePushSync } from "@/lib/usePushSync";
import { MAP_APP_NAMES, type MapApp } from "@/lib/map-app";
import { readTheme, setTheme, subscribeTheme, type ThemeChoice } from "@/lib/theme";
import { useMapApp } from "@/lib/useMapApp";
import type { Me } from "@/lib/types";
import { currentVersionInfo } from "@/lib/version-info";

const NICKNAME_MAX = 20;

function photoErrorText(e: ApiFailure): string {
  if (e.code === "STORAGE_NOT_CONFIGURED" || e.status === 503) return "사진 업로드를 지금 사용할 수 없어요";
  if (e.code === "VALIDATION_FAILED") return messageOf(e, "jpg, png, webp 10MB 까지 올릴 수 있어요");
  return messageOf(e, "사진을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요");
}

/** (#562) "달력에 음력 표시" 스위치. 바로 바꾸고 실패하면 되돌린다 */
function LunarDisplayRow({ value, onChange }: { value: boolean | undefined; onChange: (next: boolean) => void }) {
  const toast = useToast();
  const { mutate, isPending } = useUpdateLunarDisplay();
  async function toggle(next: boolean) {
    onChange(next);
    const r = await mutate(next);
    if (!r.ok) {
      onChange(!next);
      toast.show(messageOf(r.error, "음력 표시를 바꾸지 못했어요. 다시 시도해 주세요"));
    }
  }
  return (
    <ToggleRow
      label="달력에 음력 표시"
      icon={<IconMoon size={18} />}
      checked={value === true}
      disabled={value === undefined || isPending}
      onChange={(next) => void toggle(next)}
    />
  );
}

/**
 * 내 정보 상단: 프로필 칸. 누르면 시트에서 사진(바꾸기, 기본으로)과 닉네임을 바꾼다 (#378: "바꾸기" 버튼 대신 칸을 누른다).
 * color 는 지금 팀에서의 내 색. 머리줄, 사이드바 아바타와 같은 색으로 그린다 (QA 2026-11-14: 여기만 회색이었다)
 */
function ProfileCard({ me, color, onChange }: { me: Me; color: string | null; onChange: (next: Me) => void }) {
  const [open, setOpen] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { mutate: updateMe, isPending: saving } = useUpdateMe();
  const { mutate: upload, isPending: uploading } = useUploadAvatar();
  const { mutate: removeAvatar, isPending: removing } = useDeleteAvatar();
  const photoBusy = uploading || removing;

  async function saveNickname(next: string): Promise<string | null> {
    const r = await updateMe({ nickname: next });
    if (!r.ok) return messageOf(r.error, "닉네임을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요");
    // (#300) PATCH /me 응답에는 startCalendar 가 없어 앞 값을 이어 쓴다
    onChange({ ...me, ...r.data });
    return null;
  }

  function pickPhoto() {
    setPhotoError(null);
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const r = await upload(await shrinkImage(file));
    if (!r.ok) {
      setPhotoError(photoErrorText(r.error));
      return;
    }
    onChange({ ...me, profileImageUrl: r.data.profileImageUrl });
  }

  async function resetPhoto() {
    setPhotoError(null);
    const r = await removeAvatar();
    if (!r.ok) {
      setPhotoError(photoErrorText(r.error));
      return;
    }
    onChange({ ...me, profileImageUrl: null });
  }

  const avatar = (size: number) => (
    <span className="relative shrink-0">
      <Avatar member={{ displayName: me.nickname, profileImageUrl: me.profileImageUrl }} color={color} size={size} />
      {photoBusy && (
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white">
          <Spinner />
        </span>
      )}
    </span>
  );

  return (
    <section>
      <button
        type="button"
        onClick={() => {
          setPhotoError(null);
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={`${me.nickname}, 프로필 사진과 닉네임 바꾸기`}
        className="flex w-full items-center gap-3 rounded-xl bg-paper px-3.5 py-3.5 text-left hover:brightness-95"
      >
        {avatar(56)}
        <span aria-hidden="true" className="min-w-0 flex-1">
          <b className="block truncate text-[17px] font-bold leading-6 tracking-[-0.01em]">{me.nickname}</b>
          <span className="t-sub block">사진, 닉네임 바꾸기</span>
        </span>
        <IconChevronRight size={16} className="-mr-1 shrink-0 text-ink-2" />
      </button>
      {uploading && !open && (
        <p role="status" className="t-sub mt-2 px-1">
          사진을 올리는 중이에요
        </p>
      )}
      {photoError && !open && <InlineError className="mt-2 px-1">{photoError}</InlineError>}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} tabIndex={-1} aria-hidden="true" />

      <Sheet open={open} onClose={() => setOpen(false)} title="프로필">
        <div className="flex items-center gap-3 pb-3">
          {avatar(56)}
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={pickPhoto} disabled={photoBusy}>
              <IconCamera size={14} strokeWidth={2.2} />
              사진 바꾸기
            </Button>
            {me.profileImageUrl && (
              <Button size="sm" variant="secondary" onClick={resetPhoto} disabled={photoBusy}>
                기본으로
              </Button>
            )}
          </div>
        </div>
        {uploading ? (
          <p role="status" className="t-sub -mt-1 mb-3">
            사진을 올리는 중이에요
          </p>
        ) : photoError ? (
          <InlineError className="-mt-1 mb-3">{photoError}</InlineError>
        ) : (
          <p className="t-sub -mt-1 mb-3">jpg, png, webp 10MB 까지 올릴 수 있어요</p>
        )}
        <NameForm
          label="닉네임"
          value={me.nickname}
          max={NICKNAME_MAX}
          saving={saving}
          onSave={saveNickname}
          onDone={() => setOpen(false)}
          autoComplete="nickname"
          autoFocus={false}
        />
      </Sheet>
    </section>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "시스템", icon: <IconDevice size={18} /> },
  { value: "light", label: "라이트", icon: <IconSun size={18} /> },
  { value: "dark", label: "다크", icon: <IconMoon size={18} /> },
];

/** 화면 테마 선택 (시스템/라이트/다크). 고른 값은 이 브라우저에만 저장된다 */
function ThemePicker() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as ThemeChoice);
  return (
    <section className="rounded-xl bg-paper px-3.5 py-3.5">
      <h2 id="theme-label" className="text-[13px] font-bold leading-5">
        화면 테마
      </h2>
      <div className="mt-2">
        <Segmented labelledBy="theme-label" value={theme} options={THEMES} onChange={setTheme} />
      </div>
      <p className="mt-2 text-[12px] text-ink-2">시스템을 고르면 기기의 라이트/다크 설정을 따라가요</p>
    </section>
  );
}

const MAP_APPS: { value: MapApp; label: string }[] = [
  { value: "naver", label: MAP_APP_NAMES.naver },
  { value: "kakao", label: MAP_APP_NAMES.kakao },
];

/** 지도 선택 (네이버 지도 기본 / 카카오맵). 장소 검색, 일정 상세의 지도, 길찾기가 모두 이 지도를 쓴다 (D-259). 이 브라우저에만 저장된다 (lib/map-app.ts) */
function MapAppPicker() {
  const [app, setApp] = useMapApp();
  return (
    <section className="rounded-xl bg-paper px-3.5 py-3.5">
      <h2 id="map-app-label" className="text-[13px] font-bold leading-5">
        지도
      </h2>
      <div className="mt-2">
        <Segmented labelledBy="map-app-label" value={app} options={MAP_APPS} onChange={setApp} />
      </div>
      <p className="mt-2 text-[12px] text-ink-2">장소 검색, 지도, 길찾기를 이 지도로 해요</p>
    </section>
  );
}

const subscribeNothing = () => () => {};

/** (#333) 맨 아래 버전 한 줄. 누르면 복사 (문의할 때 붙여 넣게). 앱 버전은 UA 라 브라우저에서만 읽는다 */
function VersionInfo() {
  const toast = useToast();
  const text = useSyncExternalStore(
    subscribeNothing,
    () => currentVersionInfo(navigator.userAgent),
    () => currentVersionInfo(null),
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.show("버전을 복사했어요");
    } catch {
      toast.show("복사하지 못했어요");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${text}, 눌러서 복사`}
      className="hit mt-1 max-w-full break-keep rounded-sm px-3 py-1 text-[11px] leading-4 text-ink-2 hover:text-soft"
    >
      {text}
    </button>
  );
}

export function MeScreen() {
  // (#188) 푸시 지원 앱이면 이 기기 토큰을 등록, 정리
  usePushSync();
  // 지금 팀의 내 색 (AppShell 머리줄 아바타와 같은 값: 주소의 팀을 다 받았을 때만)
  const { groupId, group } = useGroupContext();
  const myColor = group && group.id === groupId ? group.me.color : null;
  const meQ = useMe();
  const groupsQ = useGroups();
  const deviceCalendar = useDeviceCalendarSupported();
  const me = meQ.data;
  const setMe = meQ.setData;
  const groups = groupsQ.data;
  const failure = meQ.error ?? groupsQ.error;
  const error = failure ? messageOf(failure, "내 정보를 불러오지 못했어요") : null;
  const [leaving, setLeaving] = useState(false);
  const [typed, setTyped] = useState("");
  // 성공 뒤 로그아웃 폼 제출로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const { mutate: deleteMe, isPending: deleting, error: deleteFailure } = useDeleteMe({ keepPendingAfterSuccess: true });
  const deleteError = deleteFailure
    ? deleteFailure.code === "KAKAO_ERROR"
      ? "카카오 연결 해제에 실패했어요. 잠시 후 다시 시도해 주세요"
      : messageOf(deleteFailure, "탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요")
    : null;

  const refetchMe = meQ.refetch;
  const refetchGroups = groupsQ.refetch;
  const load = useCallback(async () => {
    await Promise.all([refetchMe(), refetchGroups()]);
  }, [refetchMe, refetchGroups]);

  async function deleteAccount() {
    const r = await deleteMe();
    if (!r.ok) return;
    forgetGroup();
    // 기기 행은 서버가 User Cascade 로 지웠다. 이 기기 기록만 지운다 (#188, 2-3)
    forgetPushToken({ leave: true });
    // 앱 셸에 알려 카카오 SDK 토큰을 정리하게 한다 (앱 밖에서는 아무것도 안 함)
    postToApp({ type: "accountDeleted" });
    // 세션 쿠키는 httpOnly 라 로그아웃 라우트로 지운다
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth/logout";
    document.body.appendChild(form);
    form.submit();
  }

  if (leaving) {
    return (
      <div className="flex min-h-full flex-col fold:max-w-[480px]">
        {/* 머리줄 모양은 ScreenHeader 와 같다. ‹ 는 탈퇴 확인을 닫고 내 정보로 */}
        <div className="flex h-11 items-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => setLeaving(false)}
            aria-label="돌아가기"
            className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-sm text-ink hover:bg-hover"
          >
            <IconChevronLeft size={22} />
          </button>
          <h1 className="t-title min-w-0 flex-1 truncate">정말 탈퇴할까요?</h1>
        </div>
        <p className="mt-2 text-[14px] leading-5 text-soft">
          개인 달력과 그 일정은 삭제되고, 다른 팀에 남긴 일정은 &quot;탈퇴한 멤버&quot; 로 표시돼요. 카카오나 Apple
          연결도 끊어져요.
        </p>
        <label htmlFor="confirm-leave" className="mt-6 block text-[13px] font-semibold">
          계속하려면 <span className="text-danger">탈퇴</span> 라고 입력해 주세요
        </label>
        <input
          id="confirm-leave"
          className={`${inputClass} mt-2 bg-paper`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoFocus
        />
        {deleteError && <InlineError className="mt-2">{deleteError}</InlineError>}
        <div className="pt-8">
          <Button size="lg" full variant="dangerFill" disabled={typed.trim() !== "탈퇴"} loading={deleting} onClick={deleteAccount}>
            회원 탈퇴
          </Button>
          {typed.trim() !== "탈퇴" && <p className="t-sub mt-2 text-center">위 칸에 &quot;탈퇴&quot; 를 입력하면 버튼이 켜져요</p>}
        </div>
      </div>
    );
  }

  // 폰은 한 열. 본문 폭 main-lg(≥696, #323) 는 2단: 왼쪽 프로필, 줄 묶음(내 생일, 처음 여는 달력, 알림), 내 팀 / 오른쪽 화면 테마, 로그아웃, 약관, 탈퇴
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="내 정보" fallbackHref={CALENDAR_PATH} back="phone" />

      {error ? (
        <div className="mt-3">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : (
        <div className="mt-3 flex flex-1 flex-col gap-5 main-lg:grid main-lg:flex-none main-lg:grid-cols-2 main-lg:items-start main-lg:gap-3">
          <div className="flex flex-col gap-5">
            {me ? (
              <ProfileCard me={me} color={myColor} onChange={(next) => setMe(next)} />
            ) : (
              <section className="flex items-center gap-3 rounded-xl bg-paper px-3.5 py-3.5">
                <Skeleton className="size-14 rounded-full" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="mt-2 h-3 w-40" />
                </div>
              </section>
            )}
            {/* (#305) 내 생일, (#300) 처음 여는 달력 (D-191), (#188) 알림 (푸시-알림.md 8장): 설정 줄 한 묶음 */}
            <RowGroup>
              <BirthdayRow value={me?.birthday} onChange={(next) => setMe((prev) => prev && { ...prev, birthday: next })} />
              <StartCalendarRow value={me?.startCalendar} groups={groups ?? null} onChange={(next) => setMe((prev) => prev && { ...prev, startCalendar: next })} />
              {/* (#562) 달력 칸에 음력 날짜 작게 (기본 끔, 사람마다 서버에 저장해 웹과 앱이 같다) */}
              <LunarDisplayRow value={me?.showLunar} onChange={(next) => setMe((prev) => prev && { ...prev, showLunar: next })} />
              <RowLink href="/me/notifications" label="알림" icon={<IconBell size={18} />} value="" />
              {/* (#549) 휴대폰 캘린더에 일정 쓰기. 휴대폰 캘린더를 아는 앱 셸(1.3.0~)에서만 */}
              {deviceCalendar && <RowLink href="/me/device-calendar" label="휴대폰 캘린더" icon={<IconCalendar size={18} />} value="" />}
              {/* (#198) 카카오, Apple, 이메일 연결과 해제 (D-257) */}
              <RowLink href="/me/accounts" label="로그인 방법" icon={<IconKey size={18} />} value="" />
            </RowGroup>
            {/* (#515) 공지사항(안 본 공지가 있으면 코랄 점), 관리자만 관리자 화면 (D-285) */}
            <RowGroup>
              <RowLink
                href="/notices"
                label="공지사항"
                icon={<IconMegaphone size={18} />}
                value={
                  me?.hasUnreadNotice ? (
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-acc-ink">
                      <i aria-hidden="true" data-notice-dot className="block size-2 rounded-full bg-pri" />새 공지
                    </span>
                  ) : (
                    ""
                  )
                }
              />
              {me?.isAdmin && <RowLink href="/admin" label="관리자" icon={<IconShield size={18} />} value="" />}
            </RowGroup>
            <RowGroup title={`내 팀${groups ? ` ${groups.length}개` : ""}`}>
              {groups
                ? groups.map((g) => (
                    <RowLink key={g.id} href={withTeam(CALENDAR_PATH, g.publicCode)} label={g.name} value={g.type === "PERSONAL" ? "개인" : `${g.memberCount}명`} />
                  ))
                : [0, 1].map((i) => <Skeleton key={i} className="my-3 h-5 w-full" />)}
              {/* 팀 만들기 입구 (#172). 개인 달력만 있는 사용자도 여기서 시작할 수 있게 */}
              {groups && <RowLink href="/groups/new" label="팀 만들기" icon={<IconPlus size={16} strokeWidth={2.2} />} />}
            </RowGroup>
          </div>

          <div className="flex flex-1 flex-col gap-5 main-lg:flex-none">
            <ThemePicker />
            <MapAppPicker />
            <form
              method="POST"
              action="/auth/logout"
              onSubmit={(e) => {
                // 제출 순간의 값을 싣는다 (화면을 그린 뒤 등록됐을 수 있다)
                const field = e.currentTarget.elements.namedItem("pushToken");
                if (field instanceof HTMLInputElement) field.value = storedPushToken() ?? "";
                postToApp({ type: "logout" });
                // 서버 기기 해제는 route handler 가 쿠키를 지우기 전에 한다 (D-83). 이 기기 기록은 여기서 지운다
                forgetPushToken({ leave: true });
              }}
            >
              {/* (#188) 이 기기 푸시 토큰. 없으면 빈 값이라 route handler 가 건너뛴다 */}
              <input type="hidden" name="pushToken" defaultValue="" />
              <Button type="submit" variant="tile" size="lg" full>
                로그아웃
              </Button>
            </form>
            <p className="text-center text-[12px] text-ink-2">
              <Link href="/terms" className="hit inline-block underline underline-offset-2">
                이용약관
              </Link>
              <span aria-hidden="true" className="mx-2">
                |
              </span>
              <Link href="/privacy" className="hit inline-block underline underline-offset-2">
                개인정보처리방침
              </Link>
              <span aria-hidden="true" className="mx-2">
                |
              </span>
              <Link href="/support" className="hit inline-block underline underline-offset-2">
                고객 지원
              </Link>
            </p>
            <div className="mt-auto pt-4 text-center main-lg:mt-0">
              <button
                type="button"
                onClick={() => setLeaving(true)}
                className="hit rounded-sm px-3 py-2 text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-danger"
              >
                회원 탈퇴
              </button>
              {/* (#333) 회원 탈퇴 아래 작은 글씨 */}
              <div>
                <VersionInfo />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
