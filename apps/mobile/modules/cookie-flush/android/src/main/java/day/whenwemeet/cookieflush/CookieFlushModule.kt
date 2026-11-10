package day.whenwemeet.cookieflush

import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// 웹뷰 쿠키(wwm_session)를 디스크로 내린다. 앱이 백그라운드로 갈 때 호출 (docs/설계/앱.md 4.4)
// @react-native-cookies/cookies 가 새 아키텍처를 지원하지 않아 flush 하나만 로컬 모듈로 둔다
class CookieFlushModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CookieFlush")

    AsyncFunction("flush") {
      CookieManager.getInstance().flush()
    }
  }
}
