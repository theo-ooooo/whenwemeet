import { IsBoolean } from 'class-validator';

/** PATCH /me/lunar-display (#562, D-297). 달력 칸에 음력 날짜 작게 보이기 */
export class UpdateLunarDisplayDto {
  @IsBoolean({ message: 'showLunar 는 true 나 false 여야 해요' })
  showLunar!: boolean;
}
