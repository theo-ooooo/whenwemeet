import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation.js';

/** PATCH /me (D-36). 앞뒤 공백은 잘라서 저장하고, 공백만이면 길이 0 이라 거부된다 */
export class UpdateProfileDto {
  @Trim()
  @IsString({ message: '닉네임은 문자열이어야 해요' })
  @Length(1, 20, { message: '닉네임은 1~20자여야 해요' })
  nickname!: string;
}
