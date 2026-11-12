"use client";
// (#274) 일정 링크 화면의 합류 버튼. 초대 화면 JoinButton 과 같은 규칙: auto 면(이 링크에서 막 로그인하고 돌아온 경우) 누르지 않아도
// 바로 합류한다 (D-41). 성공하면 그 일정이 열린 달력으로 간다 (반복이면 그 회차)
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { messageOf, useJoinEventShare } from "@/hooks";
import { haptic } from "@/lib/app-bridge";
import { JOIN_AUTO_PARAM } from "@/lib/auth";
import { eventShareLandingHref, eventSharePath } from "@/lib/event-share";
import { rememberGroup } from "@/lib/group-cookie";

/** 자동 합류 표시(`?auto=1`)는 한 번만 쓴다 (D-41). 실패 후 새로고침하면 확인 버튼이 나온다 */
function clearAutoJoin(token: string) {
  const q = new URLSearchParams(window.location.search);
  q.delete(JOIN_AUTO_PARAM);
  const qs = q.toString();
  window.history.replaceState(window.history.state, "", `${eventSharePath(token)}${qs ? `?${qs}` : ""}`);
}

export function EventShareJoinButton({ token, auto = false }: { token: string; auto?: boolean }) {
  const router = useRouter();
  const { mutate, isPending, error: failure } = useJoinEventShare({ keepPendingAfterSuccess: true });
  const error = failure
    ? failure.code === "EVENT_SHARE_NOT_FOUND"
      ? "링크가 만료됐거나 끊겼어요. 보낸 사람에게 새 링크를 받아 주세요"
      : messageOf(failure, "합류하지 못했어요. 다시 시도해 주세요")
    : null;
  const [autoRunning, setAutoRunning] = useState(auto);
  const loading = isPending || (autoRunning && !failure);
  const started = useRef(false);

  async function join() {
    const r = await mutate(token);
    if (!r.ok) {
      setAutoRunning(false);
      return;
    }
    haptic("success");
    rememberGroup(r.data.group.id);
    router.replace(eventShareLandingHref({ groupCode: r.data.group.publicCode, eventCode: r.data.eventCode, occurrence: r.data.occurrence }));
  }

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    clearAutoJoin(token);
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
        {autoRunning && loading ? "합류하는 중…" : "팀에 합류하고 일정 보기"}
      </Button>
    </div>
  );
}
