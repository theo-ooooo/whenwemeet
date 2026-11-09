import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AvatarsModule } from '../avatars/avatars.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { UsersModule } from '../users/users.module.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';

@Module({
  imports: [AuthModule, AvatarsModule, UsersModule, MembershipsModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
