// (#197) Android 위젯 작업 처리기 (react-native-android-widget). 위젯 추가, 30분 갱신, 크기 변경 때
// 앱 프로세스의 headless JS 로 불린다. 저장된 스냅샷을 다시 읽어 지금 순간 값으로 그린다 (자정이 지나면 다음 날로)
import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { loadSnapshot } from "./store";
import { widgetProps } from "./snapshot";
import { snapshotFile } from "./native.android";
import { renderTodayWidget } from "./TodayWidget.android";

export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps): Promise<void> {
  switch (widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED": {
      const props = widgetProps(loadSnapshot(snapshotFile), Date.now());
      renderWidget(renderTodayWidget(props, widgetInfo.widgetName, widgetInfo.width));
      return;
    }
    default:
      // WIDGET_DELETED: 지울 것 없음. 누름은 OPEN_URI 라 처리기를 거치지 않는다
      return;
  }
}
