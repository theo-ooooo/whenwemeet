import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class FreeSlotsQueryDto {
  @IsDateString({}, { message: 'from 은 ISO 8601 날짜시각이어야 해요' })
  from!: string;

  @IsDateString({}, { message: 'to 는 ISO 8601 날짜시각이어야 해요' })
  to!: string;

  @IsOptional()
  @Matches(HHMM, { message: 'dayStart 는 HH:mm 형식이어야 해요' })
  dayStart: string = '09:00';

  @IsOptional()
  @Matches(HHMM, { message: 'dayEnd 는 HH:mm 형식이어야 해요' })
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
