// (#197) Android 위젯 글루: 앱 문서 폴더의 JSON 파일 + react-native-android-widget 다시 그리기.
// 위젯 갱신(30분 주기, 추가, 크기 변경)은 task-handler.android.tsx 가 같은 파일을 읽어 그 순간 값으로 그린다
import { File, Paths } from "expo-file-system";
import { requestWidgetUpdate } from "react-native-android-widget";
import { clearSnapshot, loadSnapshot, saveSnapshot, SNAPSHOT_FILE_NAME, type SnapshotFile } from "./store";
import { widgetProps, type WidgetSnapshot } from "./snapshot";
import { ANDROID_WIDGET_NAMES, renderTodayWidget } from "./TodayWidget.android";

export const snapshotFile: SnapshotFile = {
  read() {
    const f = new File(Paths.document, SNAPSHOT_FILE_NAME);
    return f.exists ? f.textSync() : null;
  },
  write(text) {
    const f = new File(Paths.document, SNAPSHOT_FILE_NAME);
    if (!f.exists) f.create();
    f.write(text);
  },
  remove() {
    const f = new File(Paths.document, SNAPSHOT_FILE_NAME);
    if (f.exists) f.delete();
  },
};

/** 홈 화면에 놓인 위젯을 지금 저장된 값으로 다시 그린다 (없으면 아무것도 안 함) */
export function redrawWidgets(): void {
  const props = widgetProps(loadSnapshot(snapshotFile), Date.now());
  for (const widgetName of Object.values(ANDROID_WIDGET_NAMES)) {
    requestWidgetUpdate({
      widgetName,
      renderWidget: (info) => renderTodayWidget(props, widgetName, info.width),
    }).catch((e: unknown) => console.warn("[widget] 다시 그리기 실패", widgetName, e));
  }
}

export function publishWidgetSnapshot(s: WidgetSnapshot): void {
  try {
    saveSnapshot(snapshotFile, s);
  } catch (e) {
    console.warn("[widget] 저장 실패", e);
    return;
  }
  redrawWidgets();
}

export function clearWidget(): void {
  clearSnapshot(snapshotFile);
  redrawWidgets();
}
