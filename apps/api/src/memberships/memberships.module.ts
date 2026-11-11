import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module.js';
import { MembershipsRepository } from './memberships.repository.js';

@Module({
  imports: [PushModule],
  providers: [MembershipsRepository],
  exports: [MembershipsRepository],
})
export class MembershipsModule {}
