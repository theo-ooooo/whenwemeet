import { Body, Controller, Delete, Get, HttpCode, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AvatarsService, type UploadedImage } from '../avatars/avatars.service.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { AvatarFileInterceptor } from './avatar-file.interceptor.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { MeService } from './me.service.js';

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly avatars: AvatarsService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthUser): AuthUser {
    return user;
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
