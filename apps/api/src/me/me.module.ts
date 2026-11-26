import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvatarsModule } from '../avatars/avatars.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { NoticesModule } from '../notices/notices.module.js';
import { UsersModule } from '../users/users.module.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';

@Module({
  imports: [
    AuthModule,
    AvatarsModule,
    UsersModule,
    MembershipsModule,
    AssistantModule,
    NoticesModule,
  ],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
