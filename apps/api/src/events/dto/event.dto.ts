import { IsBoolean, IsDateString, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Trim } from '../../common/validation.js';

export class EventInputDto {
  @Trim()
  @IsString({ message: '제목은 문자열이어야 해요' })
  @Length(1, 50, { message: '제목은 1~50자여야 해요' })
  title!: string;

  @IsDateString({}, { message: 'startsAt 은 ISO 8601 날짜시각이어야 해요' })
  startsAt!: string;

  @IsDateString({}, { message: 'endsAt 은 ISO 8601 날짜시각이어야 해요' })
  endsAt!: string;

  @IsBoolean({ message: 'allDay 는 true/false 여야 해요' })
  allDay!: boolean;

  @IsOptional()
  @IsString({ message: '메모는 문자열이어야 해요' })
  @MaxLength(500, { message: '메모는 500자 이하여야 해요' })
  memo?: string;
}

export class EventPatchDto {
  @IsOptional()
  @Trim()
  @IsString({ message: '제목은 문자열이어야 해요' })
  @Length(1, 50, { message: '제목은 1~50자여야 해요' })
  title?: string;

  @IsOptional()
  @IsDateString({}, { message: 'startsAt 은 ISO 8601 날짜시각이어야 해요' })
  startsAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'endsAt 은 ISO 8601 날짜시각이어야 해요' })
  endsAt?: string;

  @IsOptional()
  @IsBoolean({ message: 'allDay 는 true/false 여야 해요' })
  allDay?: boolean;

  @IsOptional()
  @IsString({ message: '메모는 문자열이어야 해요' })
  @MaxLength(500, { message: '메모는 500자 이하여야 해요' })
  memo?: string;
}

export class EventRangeQueryDto {
  @IsDateString({}, { message: 'from 은 ISO 8601 날짜시각이어야 해요' })
  from!: string;

  @IsDateString({}, { message: 'to 는 ISO 8601 날짜시각이어야 해요' })
  to!: string;
}
