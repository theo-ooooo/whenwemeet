import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { IsIsoDateTime } from '../../common/validation.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** dayEnd 는 그날 자정 끝을 뜻하는 `24:00` 도 받는다 (#58) */
const HHMM_END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export class FreeSlotsQueryDto {
  @IsIsoDateTime('from 은')
  from!: string;

  @IsIsoDateTime('to 는')
  to!: string;

  @IsOptional()
  @Matches(HHMM, { message: 'dayStart 는 HH:mm 형식이어야 해요' })
  dayStart: string = '09:00';

  @IsOptional()
  @Matches(HHMM_END, { message: 'dayEnd 는 HH:mm 형식이어야 해요 (00:00~24:00)' })
  dayEnd: string = '23:00';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value))
  @IsInt({ message: 'minMinutes 는 정수여야 해요' })
  @Min(30, { message: 'minMinutes 는 30 이상이어야 해요' })
  @Max(720, { message: 'minMinutes 는 720 이하여야 해요' })
  minMinutes: number = 120;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'includeAllDay 는 true/false 여야 해요' })
  includeAllDay: boolean = false;
}
