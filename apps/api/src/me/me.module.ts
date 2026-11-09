import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';

@Module({
  imports: [AuthModule, GroupsModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
