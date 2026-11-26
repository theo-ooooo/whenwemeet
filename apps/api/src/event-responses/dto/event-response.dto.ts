import { IsIn } from 'class-validator';
import {
  REACTION_KINDS,
  type ReactionKind,
  RSVP_STATUSES,
  type RsvpStatus,
} from '../responses.js';

/** (#190) PUT .../rsvp 본문. null 은 응답 취소 */
export class RsvpDto {
  @IsIn([...RSVP_STATUSES, null], {
    message: `status 는 ${RSVP_STATUSES.join(', ')} 또는 null 이어야 해요`,
  })
  status!: RsvpStatus | null;
}

/** (#190) PUT .../reaction 본문. null 은 반응 취소 */
export class ReactionDto {
  @IsIn([...REACTION_KINDS, null], {
    message: `reaction 은 ${REACTION_KINDS.join(', ')} 또는 null 이어야 해요`,
  })
  reaction!: ReactionKind | null;
}
