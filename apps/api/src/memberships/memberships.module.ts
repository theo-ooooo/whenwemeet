import { Module } from '@nestjs/common';
import { MembershipsRepository } from './memberships.repository.js';

@Module({
  providers: [MembershipsRepository],
  exports: [MembershipsRepository],
})
export class MembershipsModule {}
