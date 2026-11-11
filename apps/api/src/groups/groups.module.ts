import { Module } from '@nestjs/common';
import { EventLogsModule } from '../event-logs/event-logs.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { PushModule } from '../push/push.module.js';
import { GroupsController, InvitesController } from './groups.controller.js';
import { GroupsRepository } from './groups.repository.js';
import { GroupsService } from './groups.service.js';
import { MembershipService } from './membership.service.js';

@Module({
  imports: [MembershipsModule, EventLogsModule, PushModule],
  controllers: [GroupsController, InvitesController],
  providers: [GroupsService, MembershipService, GroupsRepository],
  exports: [GroupsService, MembershipService],
})
export class GroupsModule {}
