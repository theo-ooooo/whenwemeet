import { IsIn, IsOptional } from 'class-validator';
import type { ImportRange } from '../import-plan.js';

/** (#279) multipart 텍스트 필드 (api.md 2.9). 생략하면 기간은 오늘 이후, 참여자는 팀 종류대로 */
export class ImportOptionsDto {
  @IsOptional()
  @IsIn(['future', 'year'], { message: 'range 는 future 또는 year 여야 해요' })
  range?: ImportRange;

  @IsOptional()
  @IsIn(['ALL', 'ME'], { message: 'participants 는 ALL 또는 ME 여야 해요' })
  participants?: 'ALL' | 'ME';
}
