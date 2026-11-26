import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsIsoDateTime, Trim } from '../../common/validation.js';
import { ParticipantsConstraint } from '../../events/dto/event.dto.js';
import type { ParticipantsInput } from '../../events/participants.js';
import { MAX_POLL_OPTIONS } from '../poll-rules.js';

/** (#189) 제목 1~50자 (정하면 일정 제목이 된다) */
export const POLL_TITLE_MAX = 50;
const TITLE_MESSAGE = `제목은 1~${POLL_TITLE_MAX}자여야 해요`;
const OPTIONS_MESSAGE = '후보는 2~5개 골라 주세요';

/** 후보 하나. 개수와 시각 규칙은 서비스의 checkOptions */
export class PollOptionInputDto {
  @IsIsoDateTime('startsAt 은')
  startsAt!: string;

  @IsIsoDateTime('endsAt 은')
  endsAt!: string;

  @IsBoolean({ message: 'allDay 는 true/false 여야 해요' })
  allDay!: boolean;
}

/** 투표 만들기 (api.md 2.13 PollInput) */
export class PollInputDto {
  @Trim()
  @IsString({ message: TITLE_MESSAGE })
  @Length(1, POLL_TITLE_MAX, { message: TITLE_MESSAGE })
  title!: string;

  @IsArray({ message: OPTIONS_MESSAGE })
  @ArrayMaxSize(MAX_POLL_OPTIONS, { message: OPTIONS_MESSAGE })
  @ValidateNested({ each: true })
  @Type(() => PollOptionInputDto)
  options!: PollOptionInputDto[];

  /** 생략이나 null 이면 마감 없음 */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsIsoDateTime('deadline 은')
  deadline?: string | null;

  /** 생략하면 'ALL' (일정과 달리 투표는 팀 전체가 기본, 설계 3장) */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(ParticipantsConstraint)
  participants?: ParticipantsInput;
}

/** 내 표 전체 교체. 빈 배열 = 다 해제 */
export class PollVotesDto {
  @IsArray({ message: 'optionIds 는 후보 번호 배열이어야 해요' })
  @ArrayMaxSize(MAX_POLL_OPTIONS, {
    message: 'optionIds 는 후보 번호 배열이어야 해요',
  })
  @IsInt({ each: true, message: 'optionIds 는 후보 번호 배열이어야 해요' })
  @IsPositive({ each: true, message: 'optionIds 는 후보 번호 배열이어야 해요' })
  optionIds!: number[];
}

/** 정하기 */
export class PollConfirmDto {
  @IsInt({ message: 'optionId 는 후보 번호여야 해요' })
  @IsPositive({ message: 'optionId 는 후보 번호여야 해요' })
  optionId!: number;
}

/** 목록 쿼리 `status=open|closed` (기본 open) */
export class PollListQueryDto {
  @IsOptional()
  @IsIn(['open', 'closed'], { message: 'status 는 open 또는 closed 여야 해요' })
  status?: 'open' | 'closed';
}
