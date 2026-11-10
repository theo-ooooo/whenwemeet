"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { messageOf, useJoinGroup } from "@/hooks";
import { JOIN_AUTO_COOKIE } from "@/lib/auth";
import { rememberGroup } from "@/lib/group-cookie";

/** 자동 합류 표시 쿠키는 한 번만 쓴다. 새로고침이나 뒤로 가기로 다시 열면 확인 버튼이 나온다 */
function clearAutoJoin() {
  document.cookie = `${JOIN_AUTO_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * 초대 수락 버튼. auto 면(초대 링크에서 로그인하고 막 돌아온 경우) 누르지 않아도 바로 합류한다
 * (기획 MVP "링크 열면 로그인 후 자동 합류"). 자동 합류가 실패하면 문구와 함께 버튼으로 돌아간다
 */
export function JoinButton({ code, auto = false }: { code: string; auto?: boolean }) {
  const router = useRouter();
  // 성공 뒤 달력으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const { mutate, isPending, error: failure } = useJoinGroup({ keepPendingAfterSuccess: true });
  const error = failure ? messageOf(failure, "합류하지 못했어요. 다시 시도해 주세요") : null;
  // 첫 렌더부터 로딩으로 보여 버튼이 잠깐 보였다 사라지지 않게 한다
  const [autoRunning, setAutoRunning] = useState(auto);
  const loading = isPending || (autoRunning && !failure);
  const started = useRef(false);

  async function join() {
    const r = await mutate(code);
    if (!r.ok) {
      setAutoRunning(false);
      return;
    }
    rememberGroup(r.data.id);
    router.replace(`/g/${r.data.id}/calendar`);
  }

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    clearAutoJoin();
    void join();
    // 마운트 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-[14px] font-semibold text-danger">
          {error}
        </p>
      )}
      <Button size="lg" full loading={loading} onClick={join}>
        {autoRunning && loading ? "합류하는 중…" : "합류하기"}
      </Button>
    </div>
  );
}
