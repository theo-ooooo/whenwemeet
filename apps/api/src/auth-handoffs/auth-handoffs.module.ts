import { Module } from '@nestjs/common';
import { AuthHandoffsRepository } from './auth-handoffs.repository.js';

@Module({
  providers: [AuthHandoffsRepository],
  exports: [AuthHandoffsRepository],
})
export class AuthHandoffsModule {}
