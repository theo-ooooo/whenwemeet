import { Body, Controller, Delete, Get, Patch, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  RegisterPushDeviceDto,
  RemovePushDeviceDto,
  UpdateNotificationSettingsDto,
} from './dto/push.dto.js';
import { PushDevicesService } from './push-devices.service.js';

/** 이 기기의 푸시 토큰 (설계 7-1). 웹이 자기 세션으로 등록한다 (D-80) */
@Controller('me/push-devices')
export class PushDevicesController {
  constructor(private readonly devices: PushDevicesService) {}

  @Put()
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterPushDeviceDto) {
    return this.devices.register(user.id, {
      token: dto.token,
      platform: dto.platform,
      appVersion: dto.appVersion,
    });
  }

  /** 로그아웃 route handler 가 쿠키를 지우기 전에 부른다 (D-83) */
  @Delete()
  remove(@CurrentUser() user: AuthUser, @Body() dto: RemovePushDeviceDto) {
    return this.devices.remove(user.id, dto.token);
  }
}

/** 내 정보 > 알림 종류별 토글 (설계 7-1) */
@Controller('me/notification-settings')
export class NotificationSettingsController {
  constructor(private readonly devices: PushDevicesService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.devices.settings(user.id);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return this.devices.updateSettings(user.id, dto);
  }
}
