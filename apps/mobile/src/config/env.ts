// app.config.ts 의 extra 에서 읽는다 (빌드/업데이트 시점에 고정되는 공개값)
import Constants from "expo-constants";

type Extra = { webOrigin?: string; apiOrigin?: string; kakaoNativeAppKey?: string | null };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const env = {
  webOrigin: (extra.webOrigin ?? "https://whenwemeet.day").replace(/\/+$/, ""),
  apiOrigin: (extra.apiOrigin ?? "https://api.whenwemeet.day").replace(/\/+$/, ""),
  kakaoNativeAppKey: extra.kakaoNativeAppKey ?? null,
  version: Constants.expoConfig?.version ?? "0.0.0",
};
