import { IsBoolean, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { Trim } from '../../common/validation.js';

export class CreateGroupDto {
  @Trim()
  @IsString({ message: '팀 이름은 문자열이어야 해요' })
  @Length(1, 30, { message: '팀 이름은 1~30자여야 해요' })
  name!: string;
}

export class UpdateGroupDto {
  @Trim()
  @IsString({ message: '팀 이름은 문자열이어야 해요' })
  @Length(1, 30, { message: '팀 이름은 1~30자여야 해요' })
  name!: string;
}

export class JoinGroupDto {
  @IsString({ message: '초대 코드는 문자열이어야 해요' })
  @Length(1, 20, { message: '초대 코드를 입력해 주세요' })
  code!: string;
}

export class UpdateMeDto {
  @IsOptional()
  @IsString({ message: '색은 문자열이어야 해요' })
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: '색은 #RRGGBB 형식이어야 해요' })
  color?: string;

  /** null 을 보내면 닉네임으로 되돌린다 (api.md 2.2). undefined 는 변경 없음 */
  @Trim()
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString({ message: '표시 이름은 문자열이어야 해요' })
  @Length(1, 20, { message: '표시 이름은 1~20자여야 해요' })
  displayName?: string | null;

  /** (#188) 이 팀 알림 받기 */
  @IsOptional()
  @IsBoolean({ message: 'notify 는 true/false 여야 해요' })
  notify?: boolean;
}
