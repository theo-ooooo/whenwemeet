// (#278, D-250) 팀 만들기 쓰임별 시작 안내 상태. 서버에 저장하지 않고 이 브라우저에만 남긴다 (lib/hint.ts 와 같은 방식).
// 키 `wwm.start.<팀 id>` = "<쓰임>" 또는 "<쓰임>:<끝낸 단계>,<끝낸 단계>" (예: "two:first,todos").
// 다른 기기, 다른 멤버에게는 안내가 없다 (의도). 저장소가 막혀도(사생활 보호 모드) 화면은 안내 없이 그대로 동작한다
import { useMemo, useSyncExternalStore } from "react";
import { parsePreset, presetSteps, type PresetKey } from "./team-preset";

const PREFIX = "wwm.start.";
const EVENT = "wwm-start";

export type StartState = { preset: PresetKey; done: string[] };

/** 저장 값 → 상태. 모르는 쓰임이면 null */
export function parseStartValue(raw: string | null | undefined): StartState | null {
  if (!raw) return null;
  const [head, tail = ""] = raw.split(":", 2);
  const preset = parsePreset(head);
  if (!preset) return null;
  const known = new Set(presetSteps(preset).map((s) => s.id));
  const done = [...new Set(tail.split(",").filter((id) => known.has(id)))];
  return { preset, done };
}

export function formatStartValue(s: StartState): string {
  return s.done.length ? `${s.preset}:${s.done.join(",")}` : s.preset;
}

function readRaw(groupId: number): string | null {
  try {
    return localStorage.getItem(PREFIX + groupId);
  } catch {
    return null;
  }
}

function write(groupId: number, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(PREFIX + groupId);
    else localStorage.setItem(PREFIX + groupId, value);
  } catch {}
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** 팀을 만들며 쓰임을 고름. 안내를 처음부터 */
export function saveStart(groupId: number, preset: PresetKey) {
  write(groupId, formatStartValue({ preset, done: [] }));
}

/** 단계 하나를 끝냄. 남은 단계가 없으면 안내를 지운다. 안내가 없는 팀(다른 기기에서 만든 팀 등)은 그대로 */
export function finishStep(groupId: number, stepId: string) {
  const s = parseStartValue(readRaw(groupId));
  if (!s) return;
  const done = s.done.includes(stepId) ? s.done : [...s.done, stepId];
  const left = presetSteps(s.preset).filter((x) => !done.includes(x.id));
  write(groupId, left.length === 0 ? null : formatStartValue({ preset: s.preset, done }));
}

/** 안내 닫기 */
export function clearStart(groupId: number) {
  write(groupId, null);
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** 이 팀의 시작 안내. 서버 렌더와 첫 하이드레이션은 null (깜빡임 대신 늦게 나타남) */
export function useStartGuide(groupId: number | null): StartState | null {
  const raw = useSyncExternalStore(
    subscribe,
    () => (groupId === null ? null : readRaw(groupId)),
    () => null,
  );
  return useMemo(() => parseStartValue(raw), [raw]);
}
