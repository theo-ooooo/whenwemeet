import { IsOptional, IsString } from 'class-validator';

/** (#274) 링크 만들기. occurrence 는 반복 일정에서 필수 'YYYY-MM-DD', 한 번짜리는 무시 */
export class CreateEventShareDto {
  @IsOptional()
  @IsString({ message: 'occurrence 는 문자열이어야 해요' })
  occurrence?: string;
}
