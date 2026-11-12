// (#197) Android 위젯 작업 처리기 등록 (react-native-android-widget). 앱 진입점에서 한 번
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./task-handler.android";

export function registerWidgets(): void {
  registerWidgetTaskHandler(widgetTaskHandler);
}
