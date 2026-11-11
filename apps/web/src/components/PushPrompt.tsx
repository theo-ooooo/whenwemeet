"use client";
// (#188) 알림 권한 안내 시트 (푸시-알림.md 8-1, 기획 3-5, D-82). 루트 레이아웃에 하나만 둔다.
// 일정 저장 뒤 화면이 바뀌어도 시트가 남도록 열림 상태는 lib/push 의 모듈 상태로 둔다 (maybeOpenPushPrompt 가 연다).
// [알림 받기] 를 누를 때만 OS 권한 창을 띄운다. [나중에], 바깥 눌러 닫기는 다시 묻지 않는다
import { useState, useSyncExternalStore } from "react";
import { requestPushStatus } from "@/lib/app-bridge";
import { isPromptOpen, recordPrompt, setPromptOpen, subscribePrompt } from "@/lib/push";
import { usePushRegistrar } from "@/lib/usePushSync";
import { IconBell } from "./icons";
import { Button, Sheet } from "./ui";

export function PushPrompt() {
  const open = useSyncExternalStore(subscribePrompt, isPromptOpen, () => false);
  const apply = usePushRegistrar();
  const [asking, setAsking] = useState(false);

  function later() {
    if (asking) return;
    recordPrompt("later");
    setPromptOpen(false);
  }

  async function accept() {
    recordPrompt("accepted");
    setAsking(true);
    const status = await requestPushStatus("request");
    // 허용이면 등록, 거부면 아무 안내 없이 닫는다 (8-1)
    await apply(status);
    setAsking(false);
    setPromptOpen(false);
  }

  return (
    <Sheet open={open} onClose={later} title="알림">
      <div className="flex items-start gap-3 pb-1">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-md bg-surface text-ink-2">
          <IconBell size={20} />
        </span>
        <p className="pt-0.5 text-[16px] font-semibold leading-[22px]">약속 전에, 팀원이 일정을 바꿀 때 알려 드릴까요?</p>
      </div>
      <p className="t-sub mt-2">내 정보 &gt; 알림 에서 언제든 바꿀 수 있어요</p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="lg" onClick={later} disabled={asking} className="shrink-0 px-5">
          나중에
        </Button>
        <Button size="lg" full loading={asking} onClick={() => void accept()}>
          알림 받기
        </Button>
      </div>
    </Sheet>
  );
}
