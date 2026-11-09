"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar, Button, ErrorState, Skeleton, inputClass } from "@/components/ui";
import { ApiError, api, messageOf } from "@/lib/api";
import { forgetGroup } from "@/lib/group-cookie";
import type { GroupSummary, Me } from "@/lib/types";

export function MeScreen() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, gs] = await Promise.all([api<Me>("/me"), api<GroupSummary[]>("/groups")]);
      setError(null);
      setMe(m);
      setGroups(gs);
    } catch (e) {
      setError(messageOf(e, "내 정보를 불러오지 못했어요"));
    }
  }, []);

  useEffect(() => {
    // 효과 본문에서 직접 setState 하지 않도록 마이크로태스크로 미룬다
    queueMicrotask(() => void load());
  }, [load]);

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api("/me", { method: "DELETE" });
      forgetGroup();
      // 세션 쿠키는 httpOnly 라 로그아웃 라우트로 지운다
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/auth/logout";
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === "KAKAO_ERROR"
          ? "카카오 연결 해제에 실패했어요. 잠시 후 다시 시도해 주세요"
          : messageOf(e, "탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요");
      setDeleteError(msg);
      setDeleting(false);
    }
  }

  if (leaving) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5">
        <button
          type="button"
          onClick={() => setLeaving(false)}
          className="self-start rounded-sm px-2 py-1 text-[14px] text-ink-2 hover:bg-paper"
        >
          돌아가기
        </button>
        <h1 className="mt-8 text-[26px] font-extrabold leading-[1.2] tracking-[-0.03em]">정말 탈퇴할까요?</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
          개인 달력과 그 일정은 삭제되고, 다른 팀에 남긴 일정은 &quot;탈퇴한 멤버&quot; 로 표시돼요. 카카오 연결도
          끊어져요.
        </p>
        <label htmlFor="confirm-leave" className="mt-8 block text-[14px] font-semibold">
          계속하려면 <span className="text-danger">탈퇴</span> 라고 입력해 주세요
        </label>
        <input
          id="confirm-leave"
          className={`${inputClass} mt-2`}
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
            className="bg-danger! text-paper! border-danger!"
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
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-3">
      <div className="flex h-11 items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          className="-ml-2 rounded-sm px-2 py-1 text-[14px] text-ink-2 hover:bg-paper"
        >
          뒤로
        </button>
        <h1 className="text-[16px] font-bold">내 정보</h1>
        <span className="w-10" aria-hidden="true" />
      </div>

      {error ? (
        <div className="mt-6">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : (
        <>
          <section className="mt-6 flex items-center gap-4 rounded-lg bg-paper px-5 py-5">
            {me ? (
              <Avatar member={{ userId: me.id, displayName: me.nickname, color: "#6E4BFF", profileImageUrl: me.profileImageUrl }} size={56} />
            ) : (
              <Skeleton className="size-14 rounded-full" />
            )}
            <div className="min-w-0 flex-1">
              {me ? (
                <>
                  <p className="truncate text-[18px] font-bold">{me.nickname}</p>
                  <p className="t-sub mt-0.5">닉네임은 카카오에서 바꿀 수 있어요</p>
                </>
              ) : (
                <>
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="mt-2 h-3 w-40" />
                </>
              )}
            </div>
          </section>

          <section className="mt-4 rounded-lg bg-paper px-5 py-4">
            <h2 className="text-[14px] font-semibold text-ink-2">
              내 팀 {groups ? `${groups.length}개` : ""}
            </h2>
            <ul className="mt-2 divide-y divide-line">
              {groups
                ? groups.map((g) => (
                    <li key={g.id}>
                      <Link href={`/g/${g.id}/calendar`} className="flex items-center justify-between py-3">
                        <span className="text-[15px] font-semibold">{g.name}</span>
                        <span className="t-sub">{g.type === "PERSONAL" ? "개인" : `${g.memberCount}명`}</span>
                      </Link>
                    </li>
                  ))
                : [0, 1].map((i) => <Skeleton key={i} className="my-3 h-5 w-full" />)}
            </ul>
          </section>

          <form method="POST" action="/auth/logout" className="mt-4">
            <Button type="submit" variant="secondary" size="lg" full>
              로그아웃
            </Button>
          </form>

          <p className="t-sub mt-8 text-center">
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
              className="rounded-sm px-3 py-2 text-[13px] text-ink-2 underline underline-offset-2 hover:text-danger"
            >
              회원 탈퇴
            </button>
          </div>
        </>
      )}
    </main>
  );
}
