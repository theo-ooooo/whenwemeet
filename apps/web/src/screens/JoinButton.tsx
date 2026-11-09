"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { messageOf, useJoinGroup } from "@/hooks";
import { rememberGroup } from "@/lib/group-cookie";

export function JoinButton({ code }: { code: string }) {
  const router = useRouter();
  // 성공 뒤 달력으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const { mutate, isPending: loading, error: failure } = useJoinGroup({ keepPendingAfterSuccess: true });
  const error = failure ? messageOf(failure, "합류하지 못했어요. 다시 시도해 주세요") : null;

  async function join() {
    const r = await mutate(code);
    if (!r.ok) return;
    rememberGroup(r.data.id);
    router.replace(`/g/${r.data.id}/calendar`);
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-[14px] font-semibold text-danger">
          {error}
        </p>
      )}
      <Button size="lg" full loading={loading} onClick={join}>
        합류하기
      </Button>
    </div>
  );
}
