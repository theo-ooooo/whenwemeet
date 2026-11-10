"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Symbol } from "@/components/Logo";
import { Button, Field, inputClass } from "@/components/ui";
import { messageOf, useCreateGroup } from "@/hooks";
import { rememberGroup } from "@/lib/group-cookie";

export function NewGroupScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  // 성공 뒤 팀 설정으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const { mutate, isPending: loading, error: failure } = useCreateGroup({ keepPendingAfterSuccess: true });
  const error = failure ? messageOf(failure, "팀을 만들지 못했어요. 다시 시도해 주세요") : null;
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 30;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    const r = await mutate({ name: trimmed });
    if (!r.ok) return;
    rememberGroup(r.data.id);
    router.replace(`/g/${r.data.id}/settings?invite=1`);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] lg:pt-6">
      <div className="flex items-center justify-between">
        <Symbol size={36} />
        <Link href="/" className="flex h-8 items-center rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95">
          닫기
        </Link>
      </div>

      <form onSubmit={submit} className="mt-8 flex flex-1 flex-col px-1">
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">
          어떤 모임의
          <br />
          달력인가요?
        </h1>
        <p className="mt-2 text-[14px] leading-5 text-soft">커플, 가족, 친구 모임 어디든 좋아요</p>

        <div className="mt-6 rounded-xl bg-paper px-3.5 py-3.5">
          <Field label="팀 이름" hint={`${trimmed.length}/30`} error={error}>
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                autoFocus
                autoComplete="off"
                enterKeyHint="done"
                placeholder="예: 우리 둘, 김씨네, 목요 스터디"
              />
            )}
          </Field>
        </div>

        <div className="mt-auto pt-8">
          <Button type="submit" size="lg" full disabled={!valid} loading={loading}>
            만들기
          </Button>
          {/* 이미 있는 팀에 들어갈 사람은 만들지 않고 코드로 합류 (#56) */}
          <Link href="/join" className="mt-2 flex h-11 items-center justify-center rounded-md text-[13.5px] font-bold text-ink-2 hover:text-ink">
            초대 코드를 받았나요? 코드로 합류하기
          </Link>
        </div>
      </form>
    </main>
  );
}
