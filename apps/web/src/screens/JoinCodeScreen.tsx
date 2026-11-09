"use client";
// 초대 코드로 합류 /join (#56). 링크 없이 6자리 코드만 받은 사용자가 쓴다. 팀 전환 시트, PC 사이드바, 팀 만들기 화면에서 들어온다
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { CODE_LENGTH, CodeInput } from "@/components/CodeInput";
import { Symbol } from "@/components/Logo";
import { Button } from "@/components/ui";
import { messageOf, useJoinGroup } from "@/hooks";
import { rememberGroup } from "@/lib/group-cookie";

const NOT_FOUND = "코드가 맞지 않거나 만료됐어요. 초대한 사람에게 코드를 다시 확인해 주세요";

export function JoinCodeScreen() {
  const router = useRouter();
  const id = useId();
  const [code, setCode] = useState("");
  // 성공 뒤 달력으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const { mutate, isPending: loading, error: failure } = useJoinGroup({ keepPendingAfterSuccess: true });
  // 실패한 코드를 고치기 시작하면 문구를 지운다
  const [failedCode, setFailedCode] = useState<string | null>(null);
  const showError = failure !== null && failedCode === code;
  const error = showError
    ? failure.code === "INVITE_NOT_FOUND"
      ? NOT_FOUND
      : messageOf(failure, "합류하지 못했어요. 다시 시도해 주세요")
    : null;
  const complete = code.length === CODE_LENGTH;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!complete || loading) return;
    const r = await mutate(code);
    if (!r.ok) {
      setFailedCode(code);
      return;
    }
    rememberGroup(r.data.id);
    router.replace(`/g/${r.data.id}/calendar`);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))] lg:pt-[26px]">
      <div className="flex items-center justify-between">
        <Symbol size={36} />
        <Link href="/" className="flex h-9 items-center rounded-full bg-paper px-4 text-[13px] font-bold hover:brightness-95">
          닫기
        </Link>
      </div>

      <form onSubmit={submit} className="mt-10 flex flex-1 flex-col px-1.5">
        <h1 className="text-[40px] font-extrabold leading-[1.05] tracking-[-0.06em]">
          초대 코드를
          <br />
          입력해 주세요
        </h1>
        <p className="mt-3 text-[16px] font-medium text-soft">팀원에게 받은 6자리 코드로 같은 달력에 합류해요</p>

        <div className="mt-8 rounded-xl bg-paper px-5 py-5">
          <label htmlFor={id} className="mb-2 block text-[12px] font-semibold text-ink-2">
            초대 코드 6자리
          </label>
          <CodeInput
            id={id}
            value={code}
            onChange={setCode}
            describedBy={`${id}-msg`}
            invalid={Boolean(error)}
            disabled={loading}
            autoFocus
          />
          {error ? (
            <p id={`${id}-msg`} role="alert" className="mt-2.5 text-[13px] font-semibold text-danger">
              {error}
            </p>
          ) : (
            <p id={`${id}-msg`} className="t-sub mt-2.5">
              영문은 대문자로 바뀌어요. 초대 링크를 붙여넣어도 돼요
            </p>
          )}
        </div>

        <div className="mt-auto pt-8">
          <Button type="submit" size="lg" full disabled={!complete} loading={loading}>
            합류하기
          </Button>
          <Link href="/groups/new" className="mt-3 flex h-11 items-center justify-center rounded-full text-[14px] font-bold text-ink-2 hover:text-ink">
            새 팀 만들기
          </Link>
        </div>
      </form>
    </main>
  );
}
