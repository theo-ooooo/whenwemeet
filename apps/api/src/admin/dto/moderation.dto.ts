import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation.js';

/** (#515) 숨김 사유 1~200자 (앞뒤 공백을 자른 길이, D-286) */
export const HIDE_REASON_MAX = 200;
const REASON_MESSAGE = `숨기는 이유를 1~${HIDE_REASON_MAX}자로 적어 주세요`;

/** POST /admin/groups/:id/hide, POST /admin/events/:id/hide */
export class HideDto {
  @Trim()
  @IsString({ message: REASON_MESSAGE })
  @Length(1, HIDE_REASON_MAX, { message: REASON_MESSAGE })
  reason!: string;
}
