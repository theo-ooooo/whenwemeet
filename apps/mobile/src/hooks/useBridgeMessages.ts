// (#478) 웹 → 셸 브리지 메시지 처리 (docs/설계/앱.md 4장, 푸시-알림.md 2-2, #195 카카오톡 공유, #197 위젯, #198 로그인 방법 연결, #549 휴대폰 캘린더). WebScreen 에서 분리
import { type RefObject, useCallback } from "react";
import { Linking, Platform, Share } from "react-native";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import * as Haptics from "expo-haptics";
import { env } from "../config/env";
import { type BridgeMessage, parseBridgeMessage, shareContent } from "../bridge/messages";
import { type AppEventDetail, buildAppEventScript, buildLinkAccountReply, linkFailureReason } from "../bridge/reply";
import { isWebOrigin } from "../links/urls";
import { readPushStatus, requestPush } from "../push/notifications";
import { clearNativeSessions, nativeLinkCredentials } from "../auth/login";
import { shareKakaoFeed } from "../share/kakao";
import { clearWidget, publishWidgetSnapshot } from "../widget/native";
import { calendarStatus, clearDeviceCalendar, disableDeviceCalendar, enableDeviceCalendar, syncDeviceCalendar } from "../device-calendar/native";

type Options = {
  ref: RefObject<WebView<object> | null>;
  /** 지금 웹뷰 주소. 셸 → 웹 응답은 이 주소가 웹 오리진일 때만 보낸다 (2-2) */
  currentUrl: RefObject<string>;
  /** 웹이 로그인을 요청 */
  onLoginRequested: (next: string, reason?: "expired") => void;
  /** 웹이 당겨서 새로고침을 허용하거나 막음 (#415) */
  onPullRefreshAllow: (allow: boolean) => void;
};

/** (#198) 네이티브 로그인 시트가 떠 있는 동안 다른 linkAccount 는 바로 error 로 답한다 (SDK 로그인을 겹쳐 띄우지 않는다). 웹뷰는 하나라 모듈 값 */
let linking = false;

/** 웹뷰 onMessage. 웹 오리진에서 온 정해진 메시지만 처리한다 */
export function useBridgeMessages({ ref, currentUrl, onLoginRequested, onPullRefreshAllow }: Options): (e: WebViewMessageEvent) => void {
  /** 셸 → 웹 응답 (wwm:app 이벤트). 권한 창을 기다리는 사이 다른 사이트로 갔으면 버린다 */
  const sendToWeb = useCallback(
    (detail: AppEventDetail) => {
      if (!isWebOrigin(currentUrl.current, env.webOrigin)) return;
      ref.current?.injectJavaScript(buildAppEventScript(detail));
    },
    [ref, currentUrl],
  );

  const handleMessage = useCallback(
    (msg: BridgeMessage) => {
      switch (msg.type) {
        case "login":
          onLoginRequested(msg.next, msg.reason);
          return;
        case "logout":
          void clearNativeSessions();
          // (#197) 이전 사용자 일정이 홈 화면에 남지 않게 위젯을 로그인 안내로
          clearWidget();
          // (#549) 휴대폰 캘린더의 언제볼까 캘린더도 지운다 (켠 적이 있을 때만)
          clearDeviceCalendar();
          return;
        case "accountDeleted":
          void clearNativeSessions();
          clearWidget();
          clearDeviceCalendar();
          onLoginRequested("/");
          return;
        case "share":
          Share.share(shareContent(msg, Platform.OS === "ios" ? "ios" : "android")).catch((e: unknown) => console.warn("[share]", e));
          return;
        case "kakaoShare": {
          // 카카오톡(없으면 SDK 의 웹 공유 창) → 실패하면 OS 공유 시트 (D-169)
          const os = Platform.OS === "ios" ? "ios" : "android";
          const fallback = { url: msg.template.content.link.webUrl, text: msg.text };
          shareKakaoFeed(msg.template).catch((e: unknown) => {
            console.warn("[kakao-share] OS 공유로", e);
            Share.share(shareContent(fallback, os)).catch((err: unknown) => console.warn("[share]", err));
          });
          return;
        }
        case "haptic":
          if (msg.kind === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          else void Haptics.notificationAsync(msg.kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
          return;
        case "pushStatus":
        case "pushRequest":
          // 실패해도 답하지 않는다. 웹은 시간 초과(5초, 권한 창 60초)로 null 처리 (2-2)
          (msg.type === "pushStatus" ? readPushStatus(msg.id) : requestPush(msg.id)).then(sendToWeb).catch((e: unknown) => console.warn("[push]", msg.type, e));
          return;
        case "openSettings":
          Linking.openSettings().catch((e: unknown) => console.warn("[push] 설정 열기 실패", e));
          return;
        // (#197) 홈 화면 위젯 (앱.md 4.7). 기기 안에만 두고 서버로 보내지 않는다
        case "widgetSnapshot":
          publishWidgetSnapshot(msg.snapshot);
          return;
        case "widgetClear":
          clearWidget();
          return;
        case "pullRefresh":
          onPullRefreshAllow(msg.allow);
          return;
        // (#549) 휴대폰 캘린더 (앱.md 4.9). 기기 캘린더에만 쓰고 서버로 보내지 않는다. 실패하면 답하지 않는다 (웹은 시간 초과로 null)
        case "calendarSync":
          syncDeviceCalendar(msg.snapshot, msg.id)
            .then((r) => {
              if (r) sendToWeb(r);
            })
            .catch((e: unknown) => console.warn("[calendar] 맞추기 실패", e));
          return;
        case "calendarSyncEnable":
        case "calendarSyncDisable":
        case "calendarSyncStatus":
          (msg.type === "calendarSyncEnable"
            ? enableDeviceCalendar(msg.id)
            : msg.type === "calendarSyncDisable"
              ? disableDeviceCalendar(msg.id)
              : calendarStatus(msg.id)
          )
            .then((r) => {
              if (r) sendToWeb(r);
            })
            .catch((e: unknown) => console.warn("[calendar]", msg.type, e));
          return;
        // (#198) 로그인 방법 연결 (앱.md 4.8, D-282). 네이티브 로그인 결과만 웹으로. 토큰은 로그에 남기지 않는다
        case "linkAccount": {
          // 이미 떠 있으면 새 시트를 띄우지 않고 error 로 답한다 (먼저 띄운 쪽의 linking 은 건드리지 않는다)
          const busy = linking;
          linking = true;
          (busy ? Promise.reject(new Error("busy")) : nativeLinkCredentials(msg.provider))
            .then(
              (cred) => buildLinkAccountReply(msg.id, cred),
              (e: unknown) => {
                const reason = linkFailureReason(e);
                if (reason !== "cancelled") console.warn("[link]", msg.provider, reason, (e as { code?: unknown })?.code ?? "");
                return buildLinkAccountReply(msg.id, { reason });
              },
            )
            .then(sendToWeb)
            .finally(() => {
              if (!busy) linking = false;
            });
          return;
        }
      }
    },
    [onLoginRequested, onPullRefreshAllow, sendToWeb],
  );

  return useCallback(
    (e: WebViewMessageEvent) => {
      const msg = parseBridgeMessage(e.nativeEvent.data, e.nativeEvent.url, env.webOrigin);
      if (msg) handleMessage(msg);
    },
    [handleMessage],
  );
}
