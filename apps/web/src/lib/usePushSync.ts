"use client";
// (#188) 이 기기의 푸시 토큰을 웹 세션으로 등록, 정리한다 (푸시-알림.md 2-3, D-80).
// 로그인된 화면(AppShell, 내 정보, 알림 설정)에서만 쓴다. 로그인 화면에서 부르면 401 로 만료 처리되기 때문.
// 푸시를 모르는 앱(1.0.x)과 웹에서는 아무것도 하지 않는다
import { useCallback, useEffect, useRef } from "react";
import { useRegisterPushDevice, useRemovePushDevice } from "@/hooks";
import { appSupportsPush, requestPushStatus, type PushStatus } from "./app-bridge";
import { forgetPushToken, lastPut, rememberPushToken, storedPushToken, syncAction } from "./push";

/** 셸 응답 하나로 등록/정리를 한다. 등록에 성공하면 true */
export function usePushRegistrar() {
  const { mutate: register } = useRegisterPushDevice();
  const { mutate: remove } = useRemovePushDevice();

  return useCallback(
    async (status: PushStatus | null): Promise<boolean> => {
      const action = syncAction(status, storedPushToken(), lastPut(), Date.now());
      if (action.kind === "put") {
        const { token, platform, appVersion } = action.status;
        const r = await register({ token, platform, appVersion });
        if (r.ok) rememberPushToken(token, Date.now());
        return r.ok;
      }
      if (action.kind === "delete") {
        const r = await remove(action.token);
        if (r.ok) forgetPushToken();
      }
      return false;
    },
    [register, remove],
  );
}

/** 화면이 처음 그려질 때, 앱이 다시 앞으로 올 때 권한 상태를 물어 등록을 맞춘다 */
export function usePushSync(onStatus?: (s: PushStatus | null) => void): void {
  const apply = usePushRegistrar();
  const busy = useRef(false);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    if (!appSupportsPush()) return;
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        // 효과가 다시 돌아도(개발 모드 이중 실행 등) 진행 중인 요청 하나의 결과를 지금 구독자에게 준다
        const status = await requestPushStatus("status");
        onStatusRef.current?.(status);
        await apply(status);
      } finally {
        busy.current = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [apply]);
}
