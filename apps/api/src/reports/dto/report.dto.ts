import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { Trim } from '../../common/validation.js';

/** (#536) 신고 대상 종류, 사유 (Prisma enum ReportTargetType, ReportReason 과 같다, D-289) */
export const REPORT_TARGET_TYPES = ['group', 'event', 'user'] as const;
export const REPORT_REASONS = ['spam', 'abuse', 'illegal', 'privacy', 'other'] as const;
/** 자세한 내용 상한 (앞뒤 공백을 자른 길이) */
export const REPORT_DETAIL_MAX = 500;
/** 관리자 처리 메모 상한 */
export const REPORT_RESOLUTION_MAX = 200;

export type ReportTargetTypeValue = (typeof REPORT_TARGET_TYPES)[number];
export type ReportReasonValue = (typeof REPORT_REASONS)[number];

/** POST /reports */
export class CreateReportDto {
  @IsIn(REPORT_TARGET_TYPES, { message: 'targetType 은 group, event, user 중 하나여야 해요' })
  targetType!: ReportTargetTypeValue;

  @IsInt({ message: 'targetId 는 양의 정수여야 해요' })
  @Min(1, { message: 'targetId 는 양의 정수여야 해요' })
  @Max(2_147_483_647, { message: 'targetId 는 양의 정수여야 해요' })
  targetId!: number;

  @IsIn(REPORT_REASONS, { message: '신고 사유를 골라 주세요' })
  reason!: ReportReasonValue;

  @IsOptional()
  @Trim()
  @IsString({ message: `자세한 내용은 ${REPORT_DETAIL_MAX}자까지 적을 수 있어요` })
  @MaxLength(REPORT_DETAIL_MAX, { message: `자세한 내용은 ${REPORT_DETAIL_MAX}자까지 적을 수 있어요` })
  detail?: string;
}

/** POST /admin/reports/:id/resolve (메모 필수 1~200자) */
export class ResolveReportDto {
  @Trim()
  @IsString({ message: `처리 내용을 1~${REPORT_RESOLUTION_MAX}자로 적어 주세요` })
  @Length(1, REPORT_RESOLUTION_MAX, { message: `처리 내용을 1~${REPORT_RESOLUTION_MAX}자로 적어 주세요` })
  resolution!: string;
}

/** POST /admin/reports/:id/dismiss (메모 선택, 200자) */
export class DismissReportDto {
  @IsOptional()
  @Trim()
  @IsString({ message: `메모는 ${REPORT_RESOLUTION_MAX}자까지 적을 수 있어요` })
  @MaxLength(REPORT_RESOLUTION_MAX, { message: `메모는 ${REPORT_RESOLUTION_MAX}자까지 적을 수 있어요` })
  resolution?: string;
}
