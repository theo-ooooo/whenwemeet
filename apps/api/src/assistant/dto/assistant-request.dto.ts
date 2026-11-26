import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Trim } from '../../common/validation.js';

/** (#450) 요청 상한 (설계 AI-비서.md 2장, api.md 2.15) */
export const TEXT_MAX = 300;
export const TURN_TEXT_MAX = 600;
export const HISTORY_TURNS_MAX = 10;
export const HISTORY_CHARS_MAX = 4_000;

const HISTORY_MESSAGE = `대화 기록은 최근 ${HISTORY_TURNS_MAX}개, 합계 ${HISTORY_CHARS_MAX.toLocaleString('en-US')}자까지 보낼 수 있어요`;

/** 대화 한 턴. assistant 턴의 text 는 직전 응답의 historyText 그대로 */
export class AssistantTurnDto {
  @IsIn(['user', 'assistant'], {
    message: 'role 은 user 나 assistant 여야 해요',
  })
  role!: 'user' | 'assistant';

  @IsString({ message: `대화 한 턴은 1~${TURN_TEXT_MAX}자여야 해요` })
  @Length(1, TURN_TEXT_MAX, {
    message: `대화 한 턴은 1~${TURN_TEXT_MAX}자여야 해요`,
  })
  text!: string;
}

/** history 글자 합계 */
@ValidatorConstraint({ name: 'historyTotal' })
export class HistoryTotalConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return true;
    const total = value.reduce(
      (sum: number, turn: unknown) =>
        sum +
        (turn instanceof AssistantTurnDto && typeof turn.text === 'string'
          ? Array.from(turn.text).length
          : 0),
      0,
    );
    return total <= HISTORY_CHARS_MAX;
  }

  defaultMessage(): string {
    return HISTORY_MESSAGE;
  }
}

/** `POST /groups/:groupId/assistant/messages` 본문 (AssistantRequest) */
export class AssistantRequestDto {
  @Trim()
  @IsString({ message: '보낼 글을 적어 주세요' })
  @MinLength(1, { message: '보낼 글을 적어 주세요' })
  @MaxLength(TEXT_MAX, { message: `${TEXT_MAX}자까지 보낼 수 있어요` })
  text!: string;

  @IsOptional()
  @IsArray({ message: HISTORY_MESSAGE })
  @ArrayMaxSize(HISTORY_TURNS_MAX, { message: HISTORY_MESSAGE })
  @Validate(HistoryTotalConstraint)
  @ValidateNested({ each: true })
  @Type(() => AssistantTurnDto)
  history?: AssistantTurnDto[];
}
