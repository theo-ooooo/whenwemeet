// (#193) "다른 캘린더 앱에서 보기" 칸(ICS 피드)의 판정과 문구. 화면 문구에 "구독" 을 쓰지 않는다(유료 구독으로 읽힘) (설계 캘린더-내보내기.md 4장). 순수 함수만
import { parseAppUserAgent } from "./app-bridge";
import { formatRelative } from "./date";

export type FeedPlatform = {
  /** webcal:// 을 받아 줄 애플 기기(iPhone, iPad, Mac). Android 와 윈도우는 처리할 앱이 없을 수 있어 숨긴다 */
  apple: boolean;
  /** 폰, 태블릿. 구글 캘린더는 앱에서 URL 추가를 못 해 "컴퓨터에서만" 안내를 붙인다 */
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
  title: "다른 캘린더 앱에서 보기",
  offTeam: "구글 캘린더, 아이폰 캘린더에 이 팀 일정이 보여요. 보기만 되고, 고치는 건 언제볼까에서 해요.",
  offPersonal: "구글 캘린더, 아이폰 캘린더에 내 일정이 보여요. 보기만 되고, 고치는 건 언제볼까에서 해요.",
  /** (Q6) 다른 팀원도 같은 일을 할 수 있다는 고지. 팀만 */
  offTeamNote: "팀원 누구나 자기 연결 주소를 만들 수 있어요",
  create: "연결 주소 만들기",
  sheetTitle: "연결 주소를 만들까요?",
  sheetConfirm: "만들기",
  apple: "아이폰 캘린더에 추가",
  copy: "주소 복사",
  google: "구글 캘린더 > 다른 캘린더 + > URL로 추가에 붙여 넣으세요",
  googleMobile: "구글 캘린더는 컴퓨터에서만 추가할 수 있어요",
  copied: "연결 주소를 복사했어요",
  copyFailed: "복사하지 못했어요. 다시 시도해 주세요",
  delay: "다른 캘린더 앱에는 몇 시간 뒤에 반영될 수 있어요",
  memo: "메모 포함",
  memoOn: "일정 메모도 함께 보여요",
  memoOff: "제목, 시간, 참여자만 보여요",
  memoConfirmTitle: "메모도 보이게 할까요?",
  memoConfirmBody: "주소를 아는 사람은 일정 메모까지 볼 수 있어요",
  anniversaries: "기념일 포함",
  anniversariesDesc: "기념일과 100일, 주년을 종일 일정으로 보여요",
  rotate: "주소 다시 만들기",
  rotateTitle: "주소를 다시 만들까요?",
  rotateBody: "지금 주소는 바로 끊겨요",
  rotateConfirm: "다시 만들기",
  rotated: "새 연결 주소를 만들었어요",
  off: "연결 끊기",
  offTitle: "연결을 끊을까요?",
  offBody: "다른 캘린더 앱에 있는 일정은 더 이상 바뀌지 않아요. 그 앱에서도 지워 주세요",
  turnedOff: "연결을 끊었어요",
  loadFailed: "연결 주소를 불러오지 못했어요",
  saveFailed: "저장하지 못했어요. 다시 시도해 주세요",
} as const;

/** 고지 시트 항목: 무엇이 밖으로 나가는지, 누가 볼 수 있는지, 얼마나 걸리는지. 개인 달력은 "내 일정" */
export function feedSheetPoints(personal: boolean): string[] {
  const what = personal ? "내 일정의 제목과 시간을" : "이 팀 일정의 제목, 시간, 참여자 이름을";
  return [
    `주소를 아는 사람은 누구나 ${what} 볼 수 있어요. 다른 사람에게 보내지 마세요`,
    "메모는 나가지 않아요. 만든 뒤 켤 수 있어요",
    "다른 캘린더 앱에 보이기까지 몇 시간 걸릴 수 있어요. 보기만 되고, 고치는 건 언제볼까에서 해요",
  ];
}

/** 켜진 상태 맨 위 한 줄 */
export function feedOnNote(personal: boolean): string {
  return `주소를 아는 사람은 누구나 ${personal ? "내" : "이 팀"} 일정을 볼 수 있어요`;
}
