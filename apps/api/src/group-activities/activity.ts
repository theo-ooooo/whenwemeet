// (#191) 팀 활동 기록의 순수 규칙. Prisma 를 import 하지 않는다 (단위 테스트 대상)
import type { RsvpActivityPayload } from '../event-responses/responses.js';
import type { AnniversaryKind } from '../generated/prisma/enums.js';

/** 새 소식의 일정 밖 기록 종류 (schema.prisma GroupActivityType 과 같다) */
export type GroupActivityType =
  | 'ANNIVERSARY_CREATED'
  | 'ANNIVERSARY_UPDATED'
  | 'ANNIVERSARY_DELETED'
  | 'MEMBER_JOINED'
  | 'MEMBER_LEFT'
  | 'MEMBER_DELETED'
  | 'GROUP_RENAMED'
  /** (#279) ICS 파일로 일정을 가져옴 (D-166) */
  | 'EVENTS_IMPORTED'
  /** (#190) 참석 여부를 정하거나 바꿈 (D-227) */
  | 'EVENT_RSVP'
  /** (#189) 약속 투표를 열었다, 시간을 정했다 (D-226) */
  | 'POLL_CREATED'
  | 'POLL_CLOSED';

export type AnniversaryField = 'name' | 'date' | 'kind';

/** 기념일 값 (date 는 'YYYY-MM-DD', KST 달력 날짜) */
export interface AnniversaryValues {
  name: string;
  date: string;
  kind: AnniversaryKind;
}

/** 기념일 3종: 바뀐 뒤 값(삭제는 삭제 전 값). 수정이면 바뀐 필드와 그 필드의 이전 값 */
export interface AnniversaryPayload extends AnniversaryValues {
  changed?: AnniversaryField[];
  before?: Partial<AnniversaryValues>;
}

export interface GroupRenamedPayload {
  from: string;
  to: string;
}

/** (#279) 가져온 일정 수 */
export interface EventsImportedPayload {
  count: number;
}

/** (#274) 일정 링크로 합류 (D-185). 초대 코드 합류는 payload 없음 */
export interface MemberJoinedPayload {
  via: 'EVENT_SHARE';
}

/** (#189) 투표를 열었다. 투표가 취소되면 이 기록도 지운다 */
export interface PollCreatedPayload {
  pollId: number;
  /** 투표 공개 코드 (`/polls/<code>`) */
  code: string;
  title: string;
}

/** (#189) 시간을 정했다. eventLogId 는 이 확정으로 생긴 CREATED 로그 (새 소식에서 숨긴다, D-226) */
export interface PollClosedPayload extends PollCreatedPayload {
  eventId: number;
  eventCode: string;
  eventLogId: number;
  /** 정한 후보 (ISO) */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

/** 멤버 3종은 빈 객체 (DB 에는 null). 일정 링크 합류만 MemberJoinedPayload */
export type ActivityPayload =
  | AnniversaryPayload
  | GroupRenamedPayload
  | EventsImportedPayload
  | MemberJoinedPayload
  | RsvpActivityPayload
  | PollCreatedPayload
  | PollClosedPayload
  | Record<string, never>;

/** (#189) POLL_CLOSED 기록들이 가리키는 EventLog id (새 소식에서 숨길 확정 일정 기록, D-226) */
export function pollEventLogIds(rows: readonly { type: GroupActivityType; payload: unknown }[]): Set<number> {
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.type !== 'POLL_CLOSED' || !row.payload || typeof row.payload !== 'object') continue;
    const id = (row.payload as Partial<PollClosedPayload>).eventLogId;
    if (typeof id === 'number') ids.add(id);
  }
  return ids;
}

/** 기록할 사람. name 은 그 순간의 표시 이름 (팀 표시 이름 ?? 닉네임) 스냅샷 (D-152) */
export interface ActivityActor {
  id: number;
  name: string;
}

/** 되돌리기 판정 창: 같은 사람이 이 시간 안에 같은 값으로 다시 추가하면 삭제 기록을 지운다 (D-153) */
export const ANNIVERSARY_UNDO_WINDOW_MS = 60_000;

const FIELDS: readonly AnniversaryField[] = ['name', 'date', 'kind'];

/** 이름, 날짜, 종류 중 실제로 바뀐 것 (알림 시점은 기록하지 않는다). 같은 값이면 [] (#62 규칙) */
export function anniversaryChanges(before: AnniversaryValues, after: AnniversaryValues): AnniversaryField[] {
  return FIELDS.filter((field) => before[field] !== after[field]);
}

/** ANNIVERSARY_UPDATED payload. 바뀐 게 없으면 null (기록 안 함) */
export function anniversaryUpdatedPayload(before: AnniversaryValues, after: AnniversaryValues): AnniversaryPayload | null {
  const changed = anniversaryChanges(before, after);
  if (changed.length === 0) return null;
  const previous: Partial<AnniversaryValues> = {};
  for (const field of changed) Object.assign(previous, { [field]: before[field] });
  return { ...pickValues(after), changed, before: previous };
}

export function pickValues(values: AnniversaryValues): AnniversaryValues {
  return { name: values.name, date: values.date, kind: values.kind };
}

/** 삭제 기록의 payload 가 다시 추가하는 값과 같은가 (되돌리기 토스트는 같은 값으로 다시 POST, D-26) */
export function isSameAnniversary(payload: unknown, values: AnniversaryValues): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Partial<AnniversaryValues>;
  return p.name === values.name && p.date === values.date && p.kind === values.kind;
}

/** 표시 이름 스냅샷 (VarChar(50) 에 맞게 자른다) */
export function snapshotName(displayName: string | null, nickname: string): string {
  return Array.from(displayName ?? nickname).slice(0, 50).join('');
}
