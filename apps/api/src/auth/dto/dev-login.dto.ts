import { IsString, Length } from 'class-validator';

export class DevLoginDto {
  @IsString({ message: 'nickname 은 문자열이어야 해요' })
  @Length(1, 50, { message: 'nickname 은 1~50자여야 해요' })
  nickname!: string;
}
