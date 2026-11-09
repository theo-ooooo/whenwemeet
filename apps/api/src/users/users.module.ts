import { Module } from '@nestjs/common';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { UsersRepository } from './users.repository.js';

@Module({
  imports: [MembershipsModule],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
