import { Controller, Delete, Get } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { MeService } from './me.service.js';

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Delete()
  remove(@CurrentUser() user: AuthUser) {
    return this.me.deleteAccount(user.id);
  }
}
