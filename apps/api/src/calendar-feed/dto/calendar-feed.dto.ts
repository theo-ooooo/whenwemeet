import { IsBoolean, IsOptional } from 'class-validator';

/** (#193) PUT /groups/:groupId/calendar-feed. 없으면 만들고 있으면 설정만 바꾼다 (토큰 유지) */
export class UpsertCalendarFeedDto {
  @IsOptional()
  @IsBoolean({ message: 'includeMemo 는 true/false 여야 해요' })
  includeMemo?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'includeAnniversaries 는 true/false 여야 해요' })
  includeAnniversaries?: boolean;
}
