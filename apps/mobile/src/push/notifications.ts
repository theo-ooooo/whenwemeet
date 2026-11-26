// 푸시 알림 셸 쪽 (푸시-알림.md 9장, #188). 셸은 OS 권한과 Expo 토큰만 다루고 서버에 보내지 않는다 (D-80).
// 등록은 웹이 pushStatus 응답의 token 으로 자기 세션에서 한다.
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { env } from "../config/env";
import { buildPushStatusReply, type PushStatusReply, toPushPermission, validExpoToken } from "../bridge/reply";
import { notificationTarget } from "../links/urls";

/** API 발송의 channelId 와 같은 값 (5-6). app.config.ts 플러그인 defaultChannel 과도 같다 */
export const CHANNEL_ID = "default";
/** 웹은 pushStatus 를 5초 기다린다(2-2). 그 안에 답하도록 토큰 조회는 4초에서 끊고 token: null */
const TOKEN_TIMEOUT_MS = 4000;

const projectId: string | undefined =
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;

let configured = false;

/** 기동 시 한 번: 포그라운드 표시 규칙, Android 채널 (9장) */
export function configureNotifications(): void {
  if (configured) return;
  configured = true;
  // 앱을 보고 있어도 약속 알림이 보이게 배너, 목록, 소리. 배지는 쓰지 않는다 (D-93, D-95)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  void ensureChannel();
}

/** Android 채널. Android 13+ 권한 창은 채널이 있어야 뜨므로 pushRequest 전에도 보장한다 */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "알림",
      importance: AndroidImportance.HIGH,
    });
  } catch (e) {
    console.warn("[push] 채널 생성 실패", e);
  }
}

// 토큰은 앱 실행 동안 메모리에만 둔다 (바뀌면 다음 실행에 웹이 새 값으로 등록, 9장 "토큰 바뀜")
let cachedToken: string | null = null;
let inflight: Promise<string | null> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        console.warn("[push] 토큰 조회 실패", e);
        resolve(null);
      },
    );
  });
}

/** Expo 토큰. 실패(에뮬레이터, 네트워크, FCM 설정 없음)면 null (2-2) */
async function expoToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (!projectId) {
    console.warn("[push] EAS projectId 없음 — 토큰 없이 응답");
    return null;
  }
  inflight ??= Notifications.getExpoPushTokenAsync({ projectId })
    .then((t) => {
      cachedToken = validExpoToken(t.data);
      return cachedToken;
    })
    .finally(() => {
      inflight = null;
    });
  return withTimeout(inflight, TOKEN_TIMEOUT_MS);
}

async function reply(id: string, p: Notifications.NotificationPermissionsStatus): Promise<PushStatusReply> {
  const permission = toPushPermission(p);
  const token = permission === "granted" ? await expoToken() : null;
  return buildPushStatusReply({
    id,
    permission,
    canAskAgain: p.canAskAgain,
    token,
    os: Platform.OS === "ios" ? "ios" : "android",
    appVersion: env.version,
  });
}

/** pushStatus: 권한 상태를 읽고 허용이면 토큰까지 */
export async function readPushStatus(id: string): Promise<PushStatusReply> {
  return reply(id, await Notifications.getPermissionsAsync());
}

/**
 * pushRequest: 채널 보장 → canAskAgain 이면 OS 권한 창 → 결과 (2-2).
 * 이미 허용이거나 다시 물을 수 없으면(iOS 거부, Android 두 번 거부) 창 없이 지금 상태로 답한다.
 * Android 는 한 번 거부해도 denied + canAskAgain true 라 한 번 더 묻는다 (OS 규칙)
 */
export async function requestPush(id: string): Promise<PushStatusReply> {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (toPushPermission(current) === "granted" || !current.canAskAgain) return reply(id, current);
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return reply(id, asked);
}

/**
 * 알림 누름 (9장): 기동 시 마지막 응답(콜드 스타트) + 실행 중 응답 리스너.
 * data.url 을 notificationTarget(safeNext 규칙)으로 검사해 통과한 것만 onTarget 으로 넘긴다.
 * 같은 알림을 두 번 처리하지 않게 identifier 로 거른다 (콜드 스타트에 리스너도 같은 응답을 받을 수 있다)
 */
export function subscribeNotificationTaps(onTarget: (target: { path: string; url: string }) => void): () => void {
  const seen = new Set<string>();
  const handle = (r: Notifications.NotificationResponse | null) => {
    if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const req = r.notification.request;
    const key = `${req.identifier}:${r.notification.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    const target = notificationTarget(req.content.data, env.webOrigin);
    if (target) onTarget(target);
  };
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  try {
    handle(Notifications.getLastNotificationResponse());
    // 다음 마운트(개발 중 새로고침 등)에서 같은 알림으로 다시 이동하지 않게
    Notifications.clearLastNotificationResponse();
  } catch (e) {
    console.warn("[push] 마지막 알림 응답 읽기 실패", e);
  }
  return () => sub.remove();
}
