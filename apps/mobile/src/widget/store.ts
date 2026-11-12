// (#197) 위젯 스냅샷 저장, 비우기 (앱.md 4.7). 플랫폼 글루(native.ios.ts, native.android.ts)가 실제 저장소를 넘긴다.
// 여기는 RN 과 위젯 라이브러리를 import 하지 않는다 (jest 대상).
//   iOS     expo-widgets 타임라인 (App Group `group.day.whenwemeet.app` 의 UserDefaults). 셸에 따로 두지 않는다
//   Android 앱 문서 폴더의 JSON 파일 하나. 위젯 갱신(30분, 추가, 크기 변경) 때 다시 읽어 그 순간 값으로 그린다
import { parseWidgetSnapshot, SIGNED_OUT_PROPS, timelineEntries, type WidgetProps, type WidgetSnapshot } from "./snapshot";

/** Android 저장 파일 이름 (Paths.document 아래) */
export const SNAPSHOT_FILE_NAME = "widget-snapshot.json";

/** 파일 하나 읽기/쓰기/지우기. 없으면 read 는 null */
export type SnapshotFile = {
  read(): string | null;
  write(text: string): void;
  remove(): void;
};

export function saveSnapshot(file: SnapshotFile, s: WidgetSnapshot): void {
  file.write(JSON.stringify(s));
}

/** 저장된 스냅샷. 없거나 깨졌거나(옛 형식) 검사를 통과하지 못하면 null (위젯은 로그인 안내) */
export function loadSnapshot(file: SnapshotFile): WidgetSnapshot | null {
  let raw: string | null;
  try {
    raw = file.read();
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return parseWidgetSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearSnapshot(file: SnapshotFile): void {
  try {
    file.remove();
  } catch {
    // 없는 파일 지우기 실패는 무시 (이미 빈 상태)
  }
}

/** expo-widgets Widget 에서 쓰는 메서드만 */
export type TimelineWidget = {
  updateTimeline(entries: { date: Date; props: WidgetProps }[]): void;
  reload(): void;
};

/**
 * iOS: 스냅샷을 날짜별 타임라인으로 넣는다 (지금, 매 KST 자정, 오래됨 시각). null 이면 로그인 안내 하나로 덮는다.
 * updateTimeline 이 위젯 다시 그리기까지 한다
 */
export function publishTimeline(w: TimelineWidget, s: WidgetSnapshot | null, now: number): void {
  if (!s) {
    w.updateTimeline([{ date: new Date(now), props: SIGNED_OUT_PROPS }]);
    return;
  }
  w.updateTimeline(timelineEntries(s, now));
}
