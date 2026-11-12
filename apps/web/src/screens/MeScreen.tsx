"use client";
import Link from "next/link";
import { CALENDAR_PATH, withTeam } from "@/lib/routes";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { IconBell, IconCamera, IconChevronRight, IconDevice, IconMoon, IconPlus, IconSun } from "@/components/icons";
import { NameEditRow } from "@/components/NameEditRow";
import { StartCalendarRow } from "@/components/StartCalendarRow";
import { Avatar, Button, ErrorState, Segmented, Sheet, Skeleton, Spinner, inputClass } from "@/components/ui";
import { messageOf, useDeleteAvatar, useDeleteMe, useGroups, useMe, useUpdateMe, useUploadAvatar, type ApiFailure } from "@/hooks";
import { postToApp } from "@/lib/app-bridge";
import { forgetGroup } from "@/lib/group-cookie";
import { shrinkImage } from "@/lib/image";
import { forgetPushToken, storedPushToken } from "@/lib/push";
import { usePushSync } from "@/lib/usePushSync";
import { readTheme, setTheme, subscribeTheme, type ThemeChoice } from "@/lib/theme";
import type { Me } from "@/lib/types";

const NICKNAME_MAX = 20;

function photoErrorText(e: ApiFailure): string {
  if (e.code === "STORAGE_NOT_CONFIGURED" || e.status === 503) return "사진 업로드를 지금 사용할 수 없어요";
  if (e.code === "VALIDATION_FAILED") return messageOf(e, "jpg, png, webp 10MB 까지 올릴 수 있어요");
  return messageOf(e, "사진을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요");
}

/** 내 정보 상단: 사진(탭 → 바꾸기/기본으로), 닉네임(이름 바꾸기 공통 모양 #171) */
function ProfileCard({ me, onChange }: { me: Me; onChange: (next: Me) => void }) {
  const [photoOpen, setPhotoOpen] = useState(false);
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
    setPhotoOpen(false);
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
    setPhotoOpen(false);
    setPhotoError(null);
    const r = await removeAvatar();
    if (!r.ok) {
      setPhotoError(photoErrorText(r.error));
      return;
    }
    onChange({ ...me, profileImageUrl: null });
  }

  return (
    <section className="mt-3 rounded-xl bg-paper px-3.5 py-3.5">
      {/* 위 맞춤: 편집 중 오류 줄이 생겨도 사진이 움직이지 않는다 (#171) */}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setPhotoOpen(true)}
          disabled={photoBusy}
          aria-label="프로필 사진 바꾸기"
          className="relative shrink-0 rounded-full outline-offset-2 transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-wait"
        >
          <Avatar member={{ displayName: me.nickname, profileImageUrl: me.profileImageUrl }} size={56} />
          {/* 누르면 사진을 바꿀 수 있다는 표시 (#140 L12) */}
          <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full border-2 border-paper bg-ink text-surface">
            <IconCamera size={11} strokeWidth={2.2} />
          </span>
          {photoBusy && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white">
              <Spinner />
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <NameEditRow
            label="닉네임"
            value={me.nickname}
            max={NICKNAME_MAX}
            saving={saving}
            onSave={saveNickname}
            autoComplete="nickname"
          />
        </div>
      </div>
      {uploading && (
        <p role="status" className="t-sub mt-3">
          사진을 올리는 중이에요
        </p>
      )}
      {photoError && (
        <p role="alert" className="mt-3 text-[12px] text-danger">
          {photoError}
        </p>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} tabIndex={-1} aria-hidden="true" />

      <Sheet open={photoOpen} onClose={() => setPhotoOpen(false)} title="프로필 사진">
        <div className="flex flex-col gap-2">
          <Button size="lg" full onClick={pickPhoto}>
            사진 바꾸기
          </Button>
          {me.profileImageUrl && (
            <Button size="lg" full variant="secondary" onClick={resetPhoto}>
              기본으로
            </Button>
          )}
          <p className="t-sub mt-1 text-center">jpg, png, webp 10MB 까지 올릴 수 있어요</p>
        </div>
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
    <section className="mt-2 rounded-xl bg-paper px-3.5 py-3.5">
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

export function MeScreen() {
  const router = useRouter();
  // (#188) 푸시 지원 앱이면 이 기기 토큰을 등록, 정리
  usePushSync();
  const meQ = useMe();
  const groupsQ = useGroups();
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
      <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => setLeaving(false)}
          className="hit h-8 self-start rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95"
        >
          돌아가기
        </button>
        <h1 className="t-title mt-6">정말 탈퇴할까요?</h1>
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
        {deleteError && (
          <p role="alert" className="mt-2 text-[12px] text-danger">
            {deleteError}
          </p>
        )}
        <div className="mt-auto pt-8">
          <Button
            size="lg"
            full
            variant="dangerFill"
            disabled={typed.trim() !== "탈퇴"}
            loading={deleting}
            onClick={deleteAccount}
          >
            회원 탈퇴
          </Button>
          {typed.trim() !== "탈퇴" && <p className="t-sub mt-2 text-center">위 칸에 &quot;탈퇴&quot; 를 입력하면 버튼이 켜져요</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] lg:pt-6">
      <div className="mt-2 flex h-10 items-center justify-between lg:mt-0">
        <h1 className="t-title">내 정보</h1>
        <button type="button" onClick={() => router.back()} className="hit h-8 rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95">
          뒤로
        </button>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : (
        <>
          {me ? (
            <ProfileCard me={me} onChange={(next) => setMe(next)} />
          ) : (
            <section className="mt-3 flex items-center gap-3 rounded-xl bg-paper px-3.5 py-3.5">
              <Skeleton className="size-14 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="mt-2 h-3 w-40" />
              </div>
            </section>
          )}

          <ThemePicker />

          {/* (#300) 처음 여는 달력 (D-191) */}
          <StartCalendarRow value={me?.startCalendar} groups={groups ?? null} onChange={(next) => setMe((prev) => prev && { ...prev, startCalendar: next })} />

          {/* (#188) 알림 설정 (푸시-알림.md 8장) */}
          <Link href="/me/notifications" className="mt-2 flex min-h-12 items-center gap-2.5 rounded-xl bg-paper px-3.5 py-2 hover:brightness-95">
            <IconBell size={18} className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1 text-[15px] font-semibold">알림</span>
            <IconChevronRight size={14} className="shrink-0 text-ink-2" />
          </Link>

          <section className="mt-2 rounded-xl bg-paper px-3.5 py-3">
            <h2 className="text-[13px] font-bold leading-5">내 팀 {groups ? `${groups.length}개` : ""}</h2>
            <ul className="mt-1">
              {groups
                ? groups.map((g, i) => (
                    <li key={g.id} className={i === 0 ? "" : "border-t border-line"}>
                      <Link href={withTeam(CALENDAR_PATH, g.publicCode)} className="flex min-h-11 items-center gap-2 py-2">
                        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{g.name}</span>
                        <span className="shrink-0 text-[12px] text-ink-2">{g.type === "PERSONAL" ? "개인" : `${g.memberCount}명`}</span>
                        <IconChevronRight size={14} className="shrink-0 text-ink-2" />
                      </Link>
                    </li>
                  ))
                : [0, 1].map((i) => <Skeleton key={i} className="my-3 h-5 w-full" />)}
              {/* 팀 만들기 입구 (#172). 개인 달력만 있는 사용자도 여기서 시작할 수 있게 */}
              {groups && (
                <li className="border-t border-line">
                  <Link href="/groups/new" className="flex h-10 items-center gap-2 text-[14px] font-semibold text-acc-ink">
                    <IconPlus size={16} strokeWidth={2.2} className="shrink-0" />
                    팀 만들기
                  </Link>
                </li>
              )}
            </ul>
          </section>

          <form
            method="POST"
            action="/auth/logout"
            className="mt-2"
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

          <p className="mt-6 text-center text-[12px] text-ink-2">
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

          <div className="mt-auto pt-10 text-center">
            <button
              type="button"
              onClick={() => setLeaving(true)}
              className="hit rounded-sm px-3 py-2 text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-danger"
            >
              회원 탈퇴
            </button>
          </div>
        </>
      )}
    </main>
  );
}
