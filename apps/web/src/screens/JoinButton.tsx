"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { messageOf, useJoinGroup } from "@/hooks";
import { haptic } from "@/lib/app-bridge";
import { JOIN_AUTO_PARAM } from "@/lib/auth";
import { rememberGroup } from "@/lib/group-cookie";

/** 자동 합류 표시(`?auto=1`)는 한 번만 쓴다. 주소에서 떼어 두면 실패 후 새로고침해도 확인 버튼이 나온다 (D-41).
 *  (#196) 보낸 사람 표식(`by`)은 남긴다 */
function clearAutoJoin(code: string) {
  const q = new URLSearchParams(window.location.search);
  q.delete(JOIN_AUTO_PARAM);
  const qs = q.toString();
  window.history.replaceState(window.history.state, "", `/join/${encodeURIComponent(code)}${qs ? `?${qs}` : ""}`);
}

/**
 * 초대 수락 버튼. auto 면(초대 링크에서 로그인하고 막 돌아온 경우) 누르지 않아도 바로 합류한다
 * (기획 MVP "링크 열면 로그인 후 자동 합류"). 이미 멤버여도 합류 API 가 멱등이라 그 팀 달력으로 간다.
 * 자동 합류가 실패하면 문구와 함께 버튼으로 돌아간다
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
    haptic("success");
    rememberGroup(r.data.id);
    router.replace(`/g/${r.data.id}/calendar`);
  }

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    clearAutoJoin(code);
    void join();
    // 마운트 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-[13px] text-danger">
          {error}
        </p>
      )}
      <Button size="xl" full loading={loading} onClick={join}>
        {autoRunning && loading ? "합류하는 중…" : "합류하기"}
      </Button>
    </div>
  );
}
