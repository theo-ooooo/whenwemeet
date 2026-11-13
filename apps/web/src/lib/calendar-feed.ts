// (#193) 외부 캘린더 구독 칸의 판정과 문구 (설계 캘린더-내보내기.md 4장). 순수 함수만
import { parseAppUserAgent } from "./app-bridge";
import { formatRelative } from "./date";

export type FeedPlatform = {
  /** webcal:// 을 받아 줄 애플 기기(iPhone, iPad, Mac). Android 와 윈도우는 처리할 앱이 없을 수 있어 숨긴다 */
  apple: boolean;
  /** 폰, 태블릿. 구글 캘린더는 앱에서 URL 구독을 못 해 "컴퓨터에서" 안내를 붙인다 */
  mobile: boolean;
};

/** UA 로 고른다. 앱 셸은 UA 접미사의 os 를 믿는다 (D-53). iPadOS 사파리는 Mac 처럼 보이므로 터치 지점 수로 가른다 */
export function feedPlatform(ua: string, maxTouchPoints = 0): FeedPlatform {
  const app = parseAppUserAgent(ua);
  if (app) return { apple: app.os === "ios", mobile: true };
  const android = /Android/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const mac = !ios && /Macintosh|Mac OS X/i.test(ua);
  return { apple: !android && (ios || mac), mobile: android || ios || /Mobile/i.test(ua) };
}

/** 서버 렌더와 첫 그림: 버튼을 늘렸다 줄이지 않게 애플 버튼은 숨기고 시작 */
export const SERVER_PLATFORM: FeedPlatform = { apple: false, mobile: false };

export function lastFetchedText(iso: string | null, now = Date.now()): string {
  return iso ? `마지막으로 가져간 시간: ${formatRelative(iso, now)}` : "아직 가져가지 않았어요";
}

export const FEED_COPY = {
  title: "내 캘린더에 보이기",
  offTeam: "구글, 애플 캘린더에서 이 팀 일정을 볼 수 있어요. 팀원 누구나 자기 캘린더로 구독할 수 있어요",
  offPersonal: "구글, 애플 캘린더에서 내 일정을 볼 수 있어요",
  create: "구독 주소 만들기",
  sheetTitle: "구독 주소를 만들까요?",
  sheetConfirm: "만들기",
  apple: "애플 캘린더에 추가",
  google: "구글 캘린더에 추가",
  googleMobile: "구글 캘린더는 컴퓨터에서 열어야 추가돼요",
  copy: "주소 복사",
  copied: "구독 주소를 복사했어요",
  copyFailed: "복사하지 못했어요. 다시 시도해 주세요",
  delay: "외부 캘린더에는 몇 시간 뒤에 반영될 수 있어요",
  memo: "메모 포함",
  memoOn: "일정 메모도 함께 보여요",
  memoOff: "제목, 시간, 참여자만 보여요",
  memoConfirmTitle: "메모도 내보낼까요?",
  memoConfirmBody: "주소를 아는 사람은 일정 메모까지 볼 수 있어요",
  anniversaries: "기념일 포함",
  anniversariesDesc: "기념일과 100일, 주년을 종일 일정으로 보여요",
  rotate: "주소 다시 만들기",
  rotateTitle: "주소를 다시 만들까요?",
  rotateBody: "이전 주소로 구독한 캘린더는 더 이상 바뀌지 않아요. 새 주소로 다시 구독해 주세요",
  rotated: "새 구독 주소를 만들었어요",
  off: "끄기",
  offTitle: "구독을 끌까요?",
  offBody: "이 주소로 구독한 캘린더는 더 이상 바뀌지 않아요. 외부 캘린더에서 구독도 지워 주세요",
  turnedOff: "구독 주소를 껐어요",
  loadFailed: "구독 주소를 불러오지 못했어요",
  saveFailed: "저장하지 못했어요. 다시 시도해 주세요",
} as const;

/** 고지 시트 항목: 무엇이 밖으로 나가는지, 누가 볼 수 있는지, 얼마나 걸리는지. 개인 달력은 "내 일정" */
export function feedSheetPoints(personal: boolean): string[] {
  const what = personal ? "내 일정의 제목과 시간을" : "이 팀 일정의 제목, 시간, 참여자 이름을";
  return [
    `주소를 아는 사람은 누구나 ${what} 볼 수 있어요. 다른 사람에게 보내지 마세요`,
    "메모는 나가지 않아요. 만든 뒤 켤 수 있어요",
    "외부 캘린더 반영은 몇 시간 걸릴 수 있어요. 구독한 캘린더에서는 일정을 고칠 수 없어요",
  ];
}

/** 켜진 상태 맨 위 한 줄 */
export function feedOnNote(personal: boolean): string {
  return `주소를 아는 사람은 누구나 ${personal ? "내" : "이 팀"} 일정을 볼 수 있어요`;
}
