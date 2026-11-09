import { Module } from '@nestjs/common';
import { GroupsController, InvitesController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
import { MembershipService } from './membership.service.js';

@Module({
  controllers: [GroupsController, InvitesController],
  providers: [GroupsService, MembershipService],
  exports: [GroupsService, MembershipService],
})
export class GroupsModule {}
