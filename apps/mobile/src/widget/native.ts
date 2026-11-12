// (#197) 위젯 저장소 글루 기본값 (iOS, Android 밖: jest, 웹). 아무것도 하지 않는다.
// 실제 구현은 native.ios.ts, native.android.ts (Metro 가 플랫폼 확장자를 먼저 고른다)
import type { WidgetSnapshot } from "./snapshot";

/** 스냅샷을 기기에 두고 위젯을 다시 그린다 */
export function publishWidgetSnapshot(_s: WidgetSnapshot): void {}

/** 위젯을 로그인 안내로 되돌린다 (로그아웃, 탈퇴, widgetClear) */
export function clearWidget(): void {}
