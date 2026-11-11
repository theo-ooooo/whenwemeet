// (#188) 푸시 기기 등록과 권한 안내 시트의 규칙 (푸시-알림.md 2-3, 8-1, D-80, D-82).
// 판단은 순수 함수로 두고(단위 테스트 대상), 저장소 읽기/쓰기는 실패해도 던지지 않는 작은 함수로 감싼다.
// React 를 import 하지 않는다
import { appSupportsPush, requestPushStatus, type PushPermission, type PushStatus } from "./app-bridge";

/** 이 기기에서 마지막으로 등록에 성공한 토큰 (로그아웃 때 서버에서 지울 값) */
export const PUSH_TOKEN_KEY = "wwm_push_token";
/**
 * 권한 안내 시트에 답한 기록 (기기 단위). 'accepted' 면 다시 띄우지 않고,
 * 'later:<ms>' 면 그때부터 PROMPT_LATER_MS 가 지나면 다시 띄운다 (앱 실행 시 안내, #291).
 * 시각 없는 옛 값 'later' 는 기한이 지난 것으로 본다
 */
export const PUSH_PROMPT_KEY = "wwm_push_prompt";
/** [나중에] 뒤 다시 묻기까지 7일 */
export const PROMPT_LATER_MS = 7 * 24 * 3_600_000;
/** 같은 토큰 PUT 을 1시간에 한 번만 (sessionStorage, JSON { token, at }) */
export const PUSH_PUT_KEY = "wwm_push_put";
export const PUSH_PUT_INTERVAL_MS = 3_600_000;

export type PromptRecord = "accepted" | "later";

/* ---------- 순수 판단 ---------- */

export type SyncAction = { kind: "none" } | { kind: "put"; status: PushStatus & { token: string } } | { kind: "delete"; token: string };

/**
 * 셸 응답을 받고 할 일 (2-3).
 * - 허용 + 토큰: 등록 (같은 토큰은 1시간 안이면 건너뜀)
 * - 그 밖(토큰 없음, 거부, 미정) 인데 이 기기에 등록한 토큰이 남아 있으면: 서버에서 지운다 (OS 에서 알림을 끈 기기 정리)
 * - 응답이 없으면(시간 초과, 옛 앱) 아무것도 하지 않는다
 */
export function syncAction(
  status: PushStatus | null,
  storedToken: string | null,
  lastPut: { token: string; at: number } | null,
  now: number,
): SyncAction {
  if (!status) return { kind: "none" };
  if (status.permission === "granted" && status.token) {
    const fresh = lastPut !== null && lastPut.token === status.token && storedToken === status.token && now - lastPut.at < PUSH_PUT_INTERVAL_MS && now >= lastPut.at;
    return fresh ? { kind: "none" } : { kind: "put", status: status as PushStatus & { token: string } };
  }
  return storedToken ? { kind: "delete", token: storedToken } : { kind: "none" };
}

/**
 * OS 권한 창을 띄울 수 있는 상태인지 (#288).
 * Android 13+ 는 한 번도 묻지 않은 상태를 denied + canAskAgain true 로 준다(한 번 거부한 것과 구분되지 않음).
 * 셸 requestPush 는 이 경우 OS 창을 띄우므로 미정과 같이 다룬다
 */
export function canAskPermission(permission: PushPermission | null, canAskAgain: boolean | null | undefined): boolean {
  return permission === "undetermined" || (permission === "denied" && canAskAgain === true);
}

/** 권한 안내 시트를 띄울지 (8-1): 푸시 지원 앱 + OS 권한을 물을 수 있음 + 이 기기에서 답한 적 없음 */
export function shouldPrompt(input: {
  supported: boolean;
  permission: PushPermission | null;
  canAskAgain?: boolean | null;
  record: PromptRecord | null;
}): boolean {
  return input.supported && canAskPermission(input.permission, input.canAskAgain) && input.record === null;
}

/** sessionStorage 의 마지막 PUT 기록을 읽는다. 틀린 모양이면 null */
export function parseLastPut(raw: string | null): { token: string; at: number } | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { token?: unknown; at?: unknown };
    return typeof o.token === "string" && typeof o.at === "number" && Number.isFinite(o.at) ? { token: o.token, at: o.at } : null;
  } catch {
    return null;
  }
}

/** 저장된 답을 지금 시각 기준으로 읽는다. [나중에] 가 기한이 지났거나 틀린 값이면 null (다시 물을 수 있음) */
export function parsePromptRecord(raw: string | null, now: number = Date.now()): PromptRecord | null {
  if (raw === "accepted") return "accepted";
  const m = raw ? /^later:(\d{1,16})$/.exec(raw) : null;
  if (!m) return null;
  const at = Number(m[1]);
  return now >= at && now - at < PROMPT_LATER_MS ? "later" : null;
}

/** 저장할 값. later 는 고른 시각을 함께 둔다 */
export function encodePromptRecord(r: PromptRecord, now: number = Date.now()): string {
  return r === "later" ? `later:${now}` : r;
}

/* ---------- 저장소 (실패해도 던지지 않는다: 사파리 개인 정보 보호 모드 등) ---------- */

function storage(kind: "local" | "session"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read(kind: "local" | "session", key: string): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(kind: "local" | "session", key: string, value: string | null): void {
  try {
    const s = storage(kind);
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {}
}

export const storedPushToken = () => read("local", PUSH_TOKEN_KEY);
export const promptRecord = () => parsePromptRecord(read("local", PUSH_PROMPT_KEY));
export const lastPut = () => parseLastPut(read("session", PUSH_PUT_KEY));

// 로그아웃, 탈퇴로 떠나는 중이면 늦게 끝난 등록이 토큰 기록을 되살리지 않게 한다 (페이지가 바뀌면 풀린다)
let leaving = false;

export function rememberPushToken(token: string, now: number): void {
  if (leaving) return;
  write("local", PUSH_TOKEN_KEY, token);
  write("session", PUSH_PUT_KEY, JSON.stringify({ token, at: now }));
}

/** 서버에서 지웠거나(로그아웃, 탈퇴, OS 에서 끔) 지울 필요가 없어진 토큰 기록을 지운다. leave 면 이 페이지에서 다시 기록하지 않는다 */
export function forgetPushToken(opts: { leave?: boolean } = {}): void {
  if (opts.leave) leaving = true;
  write("local", PUSH_TOKEN_KEY, null);
  write("session", PUSH_PUT_KEY, null);
}

export function recordPrompt(r: PromptRecord): void {
  write("local", PUSH_PROMPT_KEY, encodePromptRecord(r));
}

/* ---------- 권한 안내 시트 열림 상태 (루트 레이아웃의 PushPrompt 하나가 구독) ---------- */

type Listener = () => void;
let promptOpen = false;
// 이 페이지 수명 동안 이미 띄웠거나 확인 중이면 다시 확인하지 않는다 (두 계기 중 먼저 오는 것 한 번, 8-1)
let promptChecked = false;
const listeners = new Set<Listener>();

export function subscribePrompt(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const isPromptOpen = () => promptOpen;

export function setPromptOpen(open: boolean): void {
  if (promptOpen === open) return;
  promptOpen = open;
  listeners.forEach((l) => l());
}

/** 이번 계기에서 확인을 시작해도 되는지. 한 번 true 를 주면 다시 주지 않는다 */
export function claimPromptCheck(): boolean {
  if (promptChecked) return false;
  promptChecked = true;
  return true;
}

/**
 * 권한 안내 시트 계기 (8-1, #291): ① 로그인된 화면을 처음 열 때(앱 실행) ② 일정 저장 성공 직후 ③ 알림 행에서 "없음" 이 아닌 값을 처음 고를 때.
 * 조건이 맞으면 시트를 연다. 웹, 1.0.x 앱, 이미 답한 기기, OS 권한이 정해진 기기는 아무것도 하지 않는다
 */
export async function maybeOpenPushPrompt(): Promise<void> {
  if (!appSupportsPush() || promptRecord() !== null) return;
  if (!claimPromptCheck()) return;
  const status = await requestPushStatus("status");
  if (shouldPrompt({ supported: true, permission: status?.permission ?? null, canAskAgain: status?.canAskAgain, record: promptRecord() })) setPromptOpen(true);
}

/** 테스트 전용 초기화 */
export function resetPromptStateForTest(): void {
  promptOpen = false;
  promptChecked = false;
  listeners.clear();
}
