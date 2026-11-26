import { Body, Controller, Delete, Get, HttpCode, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AvatarsService, type UploadedImage } from '../avatars/avatars.service.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { AvatarFileInterceptor } from './avatar-file.interceptor.js';
import { UpdateBirthdayDto } from './dto/update-birthday.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateLunarDisplayDto } from './dto/update-lunar-display.dto.js';
import { UpdateStartCalendarDto } from './dto/update-start-calendar.dto.js';
import { type BirthdaySettings, MeProfile, MeService, StartCalendar } from './me.service.js';

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly avatars: AvatarsService,
  ) {}

  /** (#300) 처음 여는 달력 `startCalendar`, (#305) 내 생일 `birthday` 포함 */
  @Get()
  get(@CurrentUser() user: AuthUser): Promise<MeProfile> {
    return this.me.getProfile(user);
  }

  /** (#300) 처음 여는 달력 변경 (D-191) */
  @Patch('start-calendar')
  updateStartCalendar(@CurrentUser() user: AuthUser, @Body() dto: UpdateStartCalendarDto): Promise<StartCalendar> {
    return this.me.updateStartCalendar(user.id, dto);
  }

  /** (#305) 내 생일 (월, 일만. null 이면 지우기) 과 팀원에게 알리는 시점 (D-230, D-232) */
  @Patch('birthday')
  updateBirthday(@CurrentUser() user: AuthUser, @Body() dto: UpdateBirthdayDto): Promise<BirthdaySettings> {
    return this.me.updateBirthday(user.id, dto);
  }

  /** (#562) 달력 칸에 음력 날짜 보이기 (D-297) */
  @Patch('lunar-display')
  updateLunarDisplay(@CurrentUser() user: AuthUser, @Body() dto: UpdateLunarDisplayDto): Promise<{ showLunar: boolean }> {
    return this.me.updateLunarDisplay(user.id, dto.showLunar);
  }

  /** (#450) AI 비서 처음 안내 동의. 멱등이라 200 (api.md 2.15, D-270) */
  @Post('assistant-consent')
  @HttpCode(200)
  consentAssistant(@CurrentUser() user: AuthUser): Promise<{ consentedAt: Date }> {
    return this.me.consentAssistant(user.id);
  }

  /** 닉네임 변경 (D-36) */
  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<AuthUser> {
    return this.me.updateNickname(user.id, dto.nickname);
  }

  /** 프로필 사진 업로드 (D-37). multipart 필드 `file`. 생성이 아니라 교체라 200 */
  @Post('avatar')
  @HttpCode(200)
  @RateLimit('avatarUpload')
  @UseInterceptors(AvatarFileInterceptor)
  uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedImage | undefined) {
    return this.avatars.upload(user.id, file);
  }

  /** 기본 아바타(이니셜) 로 */
  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.avatars.remove(user.id);
  }

  @Delete()
  remove(@CurrentUser() user: AuthUser) {
    return this.me.deleteAccount(user.id);
  }
}
