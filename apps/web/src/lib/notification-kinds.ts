// (#188) 알림 종류 줄: 내 정보 > 알림 의 토글과 (#528) 관리자 사용자 상세의 알림 설정(읽기 전용)이 같은 순서, 같은 이름을 쓴다
import type { NotificationSettings } from "@/lib/types";

// 설명은 한 줄 (디자인규칙.md 8-0 4). 넘치면 말줄임, 전체는 읽기 이름에
export const NOTIFICATION_KINDS: { key: keyof NotificationSettings; label: string; description: string }[] = [
  { key: "reminder", label: "일정 알림", description: "일정에 고른 시각에 알려 드려요" },
  { key: "change", label: "팀원 변경", description: "팀원이 일정을 바꾸면 알려 드려요" },
  // (#269, D-148) 기념일마다 고른 시점(당일, 하루 전, 일주일 전) 전체의 사람별 스위치
  { key: "anniversary", label: "기념일", description: "고른 날 아침 9시에 알려 드려요" },
  { key: "join", label: "새 멤버 합류", description: "초대한 사람이 들어오면 알려 드려요" },
  // (#189) 투표가 열리면 대상에게, 마감되면 연 사람에게, 시간을 정하면 대상에게
  { key: "poll", label: "약속 투표", description: "투표가 열리거나 정해지면 알려 드려요" },
  // (#277, D-203) 숫자와 사실만. 권유형 문구를 쓰지 않는다 (D-204)
  { key: "weekly", label: "주간 요약", description: "월요일 아침 9시에 그 주 일정을 알려 드려요" },
  { key: "weeklyNudge", label: "다 같이 비는 시간", description: "2주 넘게 일정이 없으면 월요일에 알려 드려요" },
  // (#528) 관리자가 푸시로 보내기로 한 공지만 온다 (D-287)
  { key: "notice", label: "공지", description: "새 기능, 점검 같은 언제볼까 소식을 알려 드려요" },
];
