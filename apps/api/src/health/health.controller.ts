import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/jwt-auth.guard.js';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health(): { ok: true } {
    return { ok: true };
  }
}
