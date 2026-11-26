// (#195) 카카오톡 공유 (피드 기본 템플릿, D-168). 웹은 카카오 JS SDK `Kakao.Share.sendDefault`, 앱 셸 안은 브리지 `kakaoShare` 로
// 셸이 네이티브 SDK(@react-native-kakao/share)로 보낸다. 템플릿 객체는 여기 한 곳에서 만들어 웹과 앱이 같은 카드를 보낸다.
// 일정 카드 공유(#274)도 kakaoFeedTemplate + shareKakaoFeed 를 그대로 쓴다 (팀 초대 전용 값은 inviteKakaoFeed 에만).
// 실패(키 없음, SDK 로드 실패, 옛 앱 셸, 예외)는 false 를 돌려 호출부가 지금 동작(OS 공유 시트, 링크 복사)으로 떨어지게 한다.
import { appSupportsKakaoShare, isInApp, postToApp } from "./app-bridge";
import { inviteShare, parseInviteBy } from "./invite-share";
import { clampTeamName, INVITER_NAME_MAX } from "./og";
import { inviteOgImage } from "./site";
import type { GroupDetail } from "./types";

/** 카카오 링크 (웹, 모바일 웹 주소만. 앱 실행 파라미터는 쓰지 않는다, D-168) */
export type KakaoLink = { webUrl: string; mobileWebUrl: string };

/** 카카오 피드 기본 템플릿. JS SDK sendDefault 와 네이티브 shareFeedTemplate 가 같이 읽는 모양만 */
export type KakaoFeedTemplate = {
  objectType: "feed";
  content: {
    title: string;
    description: string;
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    link: KakaoLink;
  };
  buttons: { title: string; link: KakaoLink }[];
};

/** 공유할 카드 한 장 (초대, 일정 카드 공용) */
export type KakaoFeedInput = {
  title: string;
  description: string;
  /** 절대 주소. 카카오 콘솔에 등록된 사이트 도메인이어야 카드가 그려진다 */
  imageUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  /** 카드와 버튼을 누르면 열 주소 (절대 주소) */
  link: string;
  buttonTitle: string;
};

/** 카카오 피드 제목, 설명은 길면 카카오가 줄여 그린다. 브리지 4KB 안에 들도록 넉넉히 자른다 */
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 200;
const BUTTON_MAX = 14;

function cut(s: string, max: number): string {
  const chars = Array.from(s.trim().replace(/\s+/g, " "));
  return chars.length <= max
    ? chars.join("")
    : `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
}

export function kakaoFeedTemplate(input: KakaoFeedInput): KakaoFeedTemplate {
  const link: KakaoLink = { webUrl: input.link, mobileWebUrl: input.link };
  return {
    objectType: "feed",
    content: {
      title: cut(input.title, TITLE_MAX),
      description: cut(input.description, DESCRIPTION_MAX),
      imageUrl: input.imageUrl,
      imageWidth: input.imageWidth ?? 1200,
      imageHeight: input.imageHeight ?? 630,
      link,
    },
    buttons: [{ title: cut(input.buttonTitle, BUTTON_MAX), link }],
  };
}

/* ---------- 팀 초대 카드 (#195, D-159 와 같은 문구, 같은 OG 이미지) ---------- */

export const INVITE_KAKAO_DESCRIPTION = "합류하면 같은 달력을 함께 보고, 모두 비는 시간을 바로 찾아요";
export const INVITE_KAKAO_BUTTON = "초대 수락하기";

/**
 * 팀 설정 초대 칸의 카드. 주소는 inviteShare(내 표식 ?by= 포함), 이미지는 같은 OG 카드 `/og/join/<code>?by=`.
 * 제목은 표식이 있으면 "{내 이름}님이 {팀} 팀에 초대했어요" (미리보기 화면, OG 제목과 같은 말), 없으면 "{팀} 팀에 초대받았어요".
 * 주소나 코드가 없으면(개인 팀) null
 */
export function inviteKakaoFeed(
  group: Pick<GroupDetail, "name" | "inviteCode" | "inviteUrl" | "inviteShareUrl"> & { me: { displayName: string } },
): KakaoFeedInput | null {
  const { url } = inviteShare(group);
  if (!url || !group.inviteCode) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const by = parseInviteBy(parsed.searchParams.get("by"));
  const team = clampTeamName(group.name);
  const name = clampTeamName(group.me.displayName, INVITER_NAME_MAX);
  const title = by && name ? `${name}님이 ${team} 팀에 초대했어요` : `${team} 팀에 초대받았어요`;
  // 이미지는 공유 주소와 같은 오리진 (운영 whenwemeet.day). 셸은 WEB_ORIGIN 밖 이미지를 버린다
  const image = inviteOgImage(group.inviteCode, by);
  return {
    title,
    description: INVITE_KAKAO_DESCRIPTION,
    imageUrl: `${parsed.origin}${image.url}`,
    imageWidth: image.width,
    imageHeight: image.height,
    link: url,
    buttonTitle: INVITE_KAKAO_BUTTON,
  };
}

/* ---------- 카카오 JS SDK (웹, 앱 셸 밖에서만) ---------- */

/** 카카오 공식 CDN, 버전과 SRI 고정 (developers.kakao.com/docs/ko/javascript/download). 올릴 때 둘 다 바꾼다 */
export const KAKAO_SDK_VERSION = "2.8.4";
export const KAKAO_SDK_URL = `https://t1.kakaocdn.net/kakao_js_sdk/${KAKAO_SDK_VERSION}/kakao.min.js`;
export const KAKAO_SDK_INTEGRITY = "sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w";
const SDK_TIMEOUT_MS = 8_000;

type KakaoSdk = {
  isInitialized: () => boolean;
  init: (key: string) => void;
  /** init 전에는 없다 (SDK 2.x 는 init 때 모듈을 붙인다) */
  Share?: { sendDefault: (template: KakaoFeedTemplate) => void };
};

/** 빌드 때 박히는 공개 JS 키. 없으면(로컬, 프리뷰) 카카오 공유를 건너뛴다 */
export function kakaoJsKey(): string | null {
  return process.env.NEXT_PUBLIC_KAKAO_JS_KEY?.trim() || null;
}

let sdkLoading: Promise<KakaoSdk | null> | null = null;

function currentSdk(): KakaoSdk | null {
  const k = (window as unknown as { Kakao?: KakaoSdk }).Kakao;
  return k && typeof k.init === "function" && typeof k.isInitialized === "function" ? k : null;
}

/** 처음 누를 때만 스크립트를 붙인다. 실패하면 다음 누름에 다시 시도 */
function loadSdk(): Promise<KakaoSdk | null> {
  const ready = currentSdk();
  if (ready) return Promise.resolve(ready);
  if (sdkLoading) return sdkLoading;
  const loading = new Promise<KakaoSdk | null>((resolve) => {
    const s = document.createElement("script");
    s.src = KAKAO_SDK_URL;
    s.integrity = KAKAO_SDK_INTEGRITY;
    s.crossOrigin = "anonymous";
    s.async = true;
    const timer = setTimeout(() => done(null), SDK_TIMEOUT_MS);
    function done(v: KakaoSdk | null) {
      clearTimeout(timer);
      if (!v) s.remove();
      resolve(v);
    }
    s.onload = () => done(currentSdk());
    s.onerror = () => done(null);
    document.head.appendChild(s);
  });
  // 끝나면 비운다. 성공이면 다음부터 window.Kakao 를 바로 쓰고, 실패면 다음 누름에 태그를 다시 붙인다
  sdkLoading = loading;
  void loading.then(() => {
    if (sdkLoading === loading) sdkLoading = null;
  });
  return loading;
}

/**
 * 공유 버튼이 있는 칸이 보일 때 SDK 를 미리 받는다 (#195 "초대 칸이 보일 때만 지연 로드").
 * 누른 뒤에 처음 받으면 PC 의 카카오 공유 창(window.open)이 사용자 동작 밖이라 팝업 차단에 걸릴 수 있다.
 * 앱 셸 안, 키 없음, 서버에서는 아무것도 하지 않는다
 */
export function preloadKakaoSdk(): void {
  if (typeof window === "undefined" || isInApp() || !kakaoJsKey()) return;
  void loadSdk();
}

/**
 * 카카오톡으로 카드 한 장을 보낸다. 보냈으면(앱에 넘겼거나 SDK 를 불렀으면) true, 아니면 false (호출부는 지금 동작으로).
 * - 앱 셸 안: 셸이 `KakaoShare/1` 을 알릴 때만 브리지 `kakaoShare`. 옛 셸(1.1.0)이면 false. 웹뷰 안에서는 JS SDK 를 부르지 않는다
 *   (SDK 가 intent:, kakaolink:// 로 이동하는데 셸이 그 주소를 다루지 않는다, #195 방식 B)
 * - 브라우저: 키가 있으면 SDK 지연 로드 → init → sendDefault (모바일은 카카오톡, PC 는 카카오 웹 공유 창)
 * @param fallbackText 셸이 카카오톡 공유에 실패하면 여는 OS 공유 시트의 본문 (주소는 셸이 붙인다)
 */
export async function shareKakaoFeed(input: KakaoFeedInput, fallbackText?: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const template = kakaoFeedTemplate(input);
  if (isInApp()) {
    if (!appSupportsKakaoShare(navigator.userAgent)) return false;
    return postToApp({ type: "kakaoShare", template, ...(fallbackText ? { text: fallbackText } : {}) });
  }
  const key = kakaoJsKey();
  if (!key) return false;
  try {
    const sdk = await loadSdk();
    if (!sdk) return false;
    if (!sdk.isInitialized()) sdk.init(key);
    if (typeof sdk.Share?.sendDefault !== "function") return false;
    sdk.Share.sendDefault(template);
    return true;
  } catch (e) {
    console.warn("[kakao-share]", e);
    return false;
  }
}
