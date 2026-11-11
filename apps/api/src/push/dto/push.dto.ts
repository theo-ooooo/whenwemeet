import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

/** Expo 푸시 토큰 형식 (설계 7-1) */
export const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,180}\]$/;
const TOKEN_MESSAGE = 'token 은 Expo 푸시 토큰 형식이어야 해요';
const PLATFORMS = ['IOS', 'ANDROID'] as const;

export class RegisterPushDeviceDto {
  @IsString({ message: TOKEN_MESSAGE })
  @Matches(EXPO_TOKEN_PATTERN, { message: TOKEN_MESSAGE })
  token!: string;

  @IsIn(PLATFORMS, { message: 'platform 은 IOS, ANDROID 중 하나여야 해요' })
  platform!: 'IOS' | 'ANDROID';

  @IsString({ message: 'appVersion 은 문자열이어야 해요' })
  @Length(1, 20, { message: 'appVersion 은 1~20자여야 해요' })
  appVersion!: string;
}

export class RemovePushDeviceDto {
  @IsString({ message: TOKEN_MESSAGE })
  @Matches(EXPO_TOKEN_PATTERN, { message: TOKEN_MESSAGE })
  token!: string;
}

/** 내 정보 > 알림. 불리언만, 빈 본문은 그대로 */
export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'reminder 는 true/false 여야 해요' })
  reminder?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'change 는 true/false 여야 해요' })
  change?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'anniversary 는 true/false 여야 해요' })
  anniversary?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'join 은 true/false 여야 해요' })
  join?: boolean;
}
