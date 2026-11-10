"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { IconDevice, IconMoon, IconSun } from "@/components/icons";
import { Avatar, Button, ErrorState, Sheet, Skeleton, Spinner, inputClass } from "@/components/ui";
import { messageOf, useDeleteAvatar, useDeleteMe, useGroups, useMe, useUpdateMe, useUploadAvatar, type ApiFailure } from "@/hooks";
import { postToApp } from "@/lib/app-bridge";
import { forgetGroup } from "@/lib/group-cookie";
import { shrinkImage } from "@/lib/image";
import { readTheme, setTheme, subscribeTheme, type ThemeChoice } from "@/lib/theme";
import type { Me } from "@/lib/types";

const NICKNAME_MAX = 20;

/** 닉네임 규칙 (api.md PATCH /me). 통과하면 null */
function nicknameProblem(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return "닉네임을 입력해 주세요";
  if (v.length > NICKNAME_MAX) return `닉네임은 ${NICKNAME_MAX}자까지 쓸 수 있어요`;
  return null;
}

function photoErrorText(e: ApiFailure): string {
  if (e.code === "STORAGE_NOT_CONFIGURED" || e.status === 503) return "사진 업로드를 지금 사용할 수 없어요";
  if (e.code === "VALIDATION_FAILED") return messageOf(e, "jpg, png, webp 10MB 까지 올릴 수 있어요");
  return messageOf(e, "사진을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요");
}

/** 내 정보 상단: 사진(탭 → 바꾸기/기본으로), 닉네임(탭 → 인라인 편집) */
function ProfileCard({ me, onChange }: { me: Me; onChange: (next: Me) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(me.nickname);
  const [nickError, setNickError] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { mutate: updateMe, isPending: saving } = useUpdateMe();
  const { mutate: upload, isPending: uploading } = useUploadAvatar();
  const { mutate: removeAvatar, isPending: removing } = useDeleteAvatar();
  const photoBusy = uploading || removing;

  function startEdit() {
    setDraft(me.nickname);
    setNickError(null);
    setEditing(true);
  }

  async function saveNickname(e: React.FormEvent) {
    e.preventDefault();
    const problem = nicknameProblem(draft);
    if (problem) {
      setNickError(problem);
      return;
    }
    const next = draft.trim();
    if (next === me.nickname) {
      setEditing(false);
      return;
    }
    const r = await updateMe({ nickname: next });
    if (!r.ok) {
      setNickError(messageOf(r.error, "닉네임을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요"));
      return;
    }
    onChange(r.data);
    setEditing(false);
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
    <section className="mt-5 rounded-xl bg-paper px-5 py-5">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setPhotoOpen(true)}
          disabled={photoBusy}
          aria-label="프로필 사진 바꾸기"
          className="relative shrink-0 rounded-full outline-offset-2 transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-wait"
        >
          <Avatar member={{ displayName: me.nickname, profileImageUrl: me.profileImageUrl }} size={64} />
          {photoBusy && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white">
              <Spinner />
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={saveNickname} noValidate>
              <label htmlFor="nickname" className="sr-only">
                닉네임
              </label>
              <input
                id="nickname"
                className={inputClass}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setNickError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                }}
                maxLength={NICKNAME_MAX}
                autoComplete="nickname"
                autoFocus
                aria-invalid={nickError ? true : undefined}
                aria-describedby={nickError ? "nickname-error" : "nickname-count"}
              />
              <div className="mt-2 flex items-center gap-1.5">
                <span id="nickname-count" className={`mr-auto text-[12px] font-semibold ${draft.trim().length > NICKNAME_MAX ? "text-danger" : "text-ink-2"}`}>
                  {draft.trim().length}/{NICKNAME_MAX}
                </span>
                <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
                  취소
                </Button>
                <Button size="sm" type="submit" loading={saving}>
                  저장
                </Button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="-mx-2 -my-1 block w-[calc(100%+16px)] rounded-lg px-2 py-1 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-ink"
            >
              <span className="block truncate text-[22px] font-extrabold tracking-[-0.04em]">{me.nickname}</span>
              <span className="t-sub mt-0.5 block">눌러서 닉네임 바꾸기</span>
            </button>
          )}
        </div>
      </div>
      {nickError && (
        <p id="nickname-error" role="alert" className="mt-3 text-[13px] text-danger">
          {nickError}
        </p>
      )}
      {uploading && (
        <p role="status" className="t-sub mt-3">
          사진을 올리는 중이에요
        </p>
      )}
      {photoError && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
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
    <section className="mt-2 rounded-xl bg-paper px-5 py-5">
      <h2 id="theme-label" className="text-[12px] font-semibold text-ink-2">
        화면 테마
      </h2>
      <div role="radiogroup" aria-labelledby="theme-label" className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-surface p-1">
        {THEMES.map((t) => {
          const on = theme === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setTheme(t.value)}
              className={`anim-pick flex h-11 items-center justify-center gap-1.5 rounded-full text-[14px] font-bold ${on ? "bg-today text-sel-ink" : "text-soft hover:text-ink"}`}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-[12px] font-semibold text-ink-2">시스템을 고르면 기기의 라이트/다크 설정을 따라가요</p>
    </section>
  );
}

export function MeScreen() {
  const router = useRouter();
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
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => setLeaving(false)}
          className="h-9 self-start rounded-full bg-paper px-4 text-[13px] font-bold hover:brightness-95"
        >
          돌아가기
        </button>
        <h1 className="mt-8 text-[34px] font-extrabold leading-[1.1] tracking-[-0.05em]">정말 탈퇴할까요?</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-soft">
          개인 달력과 그 일정은 삭제되고, 다른 팀에 남긴 일정은 &quot;탈퇴한 멤버&quot; 로 표시돼요. 카카오 연결도
          끊어져요.
        </p>
        <label htmlFor="confirm-leave" className="mt-8 block text-[13px] font-semibold">
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
          <p role="alert" className="mt-3 text-[14px] text-danger">
            {deleteError}
          </p>
        )}
        <div className="mt-auto pt-8">
          <Button
            size="lg"
            full
            variant="danger"
            className="bg-danger! text-white!"
            disabled={typed.trim() !== "탈퇴"}
            loading={deleting}
            onClick={deleteAccount}
          >
            회원 탈퇴
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))] lg:pt-[26px]">
      <div className="mt-[22px] flex items-center justify-between px-1.5 lg:mt-0">
        <h1 className="t-title">내 정보</h1>
        <button type="button" onClick={() => router.back()} className="h-9 rounded-full bg-paper px-4 text-[13px] font-bold hover:brightness-95">
          뒤로
        </button>
      </div>

      {error ? (
        <div className="mt-5">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : (
        <>
          {me ? (
            <ProfileCard me={me} onChange={(next) => setMe(next)} />
          ) : (
            <section className="mt-5 flex items-center gap-4 rounded-xl bg-paper px-5 py-5">
              <Skeleton className="size-16 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="mt-2 h-3 w-40" />
              </div>
            </section>
          )}

          <ThemePicker />

          <section className="mt-2 rounded-xl bg-paper px-5 py-4">
            <h2 className="text-[12px] font-semibold text-ink-2">내 팀 {groups ? `${groups.length}개` : ""}</h2>
            <ul className="mt-1">
              {groups
                ? groups.map((g, i) => (
                    <li key={g.id} className={i === 0 ? "" : "border-t border-line"}>
                      <Link href={`/g/${g.id}/calendar`} className="flex items-center justify-between py-3">
                        <span className="truncate text-[16px] font-bold tracking-[-0.02em]">{g.name}</span>
                        <span className="text-[12px] font-semibold text-ink-2">{g.type === "PERSONAL" ? "개인" : `${g.memberCount}명`}</span>
                      </Link>
                    </li>
                  ))
                : [0, 1].map((i) => <Skeleton key={i} className="my-3 h-5 w-full" />)}
            </ul>
          </section>

          <form method="POST" action="/auth/logout" className="mt-2" onSubmit={() => postToApp({ type: "logout" })}>
            <Button type="submit" variant="tile" size="lg" full>
              로그아웃
            </Button>
          </form>

          <p className="mt-8 text-center text-[12px] font-semibold text-ink-2">
            <Link href="/terms" className="underline underline-offset-2">
              이용약관
            </Link>
            <span aria-hidden="true" className="mx-2">
              |
            </span>
            <Link href="/privacy" className="underline underline-offset-2">
              개인정보처리방침
            </Link>
          </p>

          <div className="mt-auto pt-10 text-center">
            <button
              type="button"
              onClick={() => setLeaving(true)}
              className="rounded-full px-3 py-2 text-[13px] font-semibold text-ink-2 underline underline-offset-2 hover:text-danger"
            >
              회원 탈퇴
            </button>
          </div>
        </>
      )}
    </main>
  );
}
