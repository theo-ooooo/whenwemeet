import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, Matches } from 'class-validator';
import { IMPORT_MAX_EVENTS, type ImportRange } from '../import-plan.js';

/** (#279) multipart 텍스트 필드 (api.md 2.9). 생략하면 기간은 오늘 이후, 참여자는 팀 종류대로 */
export class ImportOptionsDto {
  @IsOptional()
  @IsIn(['future', 'year', 'all'], { message: 'range 는 future, year, all 중 하나여야 해요' })
  range?: ImportRange;

  @IsOptional()
  @IsIn(['ALL', 'ME'], { message: 'participants 는 ALL 또는 ME 여야 해요' })
  participants?: 'ALL' | 'ME';
}

export const INCLUDE_EMPTY_MESSAGE = '넣을 일정을 하나 이상 골라 주세요';
const INCLUDE_FORMAT_MESSAGE = 'include 는 미리보기의 key 목록(JSON 배열)이어야 해요';

/** multipart 는 빈 배열을 나타낼 수 없어 JSON 문자열로 받는다. 못 읽으면 원래 값을 두어 IsArray 가 400 을 낸다 */
function parseJsonArray({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * (#314) 넣기 요청. include 는 미리보기 items[].key 중 넣을 것 (D-194). 생략하면 전부, 빈 배열은 400,
 * 이번 파일에 없는 키는 무시한다
 */
export class ImportCreateDto extends ImportOptionsDto {
  @IsOptional()
  @Transform(parseJsonArray)
  @IsArray({ message: INCLUDE_FORMAT_MESSAGE })
  @ArrayNotEmpty({ message: INCLUDE_EMPTY_MESSAGE })
  @ArrayMaxSize(IMPORT_MAX_EVENTS, { message: `include 는 ${IMPORT_MAX_EVENTS.toLocaleString('en-US')}개까지예요` })
  @Matches(/^[0-9a-f]{64}$/, { each: true, message: INCLUDE_FORMAT_MESSAGE })
  include?: string[];
}
