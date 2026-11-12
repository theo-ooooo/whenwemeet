import { registerRootComponent } from "expo";
import App from "./src/App";
import { registerWidgets } from "./src/widget/register";

registerRootComponent(App);
// (#197) Android 홈 화면 위젯 작업 처리기 (iOS 는 expo-widgets 가 따로 그린다)
registerWidgets();
