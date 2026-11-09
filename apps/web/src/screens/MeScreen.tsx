"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import { IconDevice, IconMoon, IconSun } from "@/components/icons";
import { Avatar, Button, ErrorState, Skeleton, inputClass } from "@/components/ui";
import { messageOf, useDeleteMe, useGroups, useMe } from "@/hooks";
import { forgetGroup } from "@/lib/group-cookie";
import { readTheme, setTheme, subscribeTheme, type ThemeChoice } from "@/lib/theme";

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
          <section className="mt-5 flex items-center gap-4 rounded-xl bg-paper px-5 py-5">
            {me ? (
              <Avatar member={{ displayName: me.nickname, profileImageUrl: me.profileImageUrl }} size={56} />
            ) : (
              <Skeleton className="size-14 rounded-full" />
            )}
            <div className="min-w-0 flex-1">
              {me ? (
                <>
                  <p className="truncate text-[22px] font-extrabold tracking-[-0.04em]">{me.nickname}</p>
                  <p className="t-sub mt-0.5">닉네임은 카카오에서 바꿀 수 있어요</p>
                </>
              ) : (
                <>
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="mt-2 h-3 w-40" />
                </>
              )}
            </div>
          </section>

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

          <form method="POST" action="/auth/logout" className="mt-2">
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
