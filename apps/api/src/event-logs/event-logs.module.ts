import { Module } from '@nestjs/common';
import { EventLogsRepository } from './event-logs.repository.js';

@Module({
  providers: [EventLogsRepository],
  exports: [EventLogsRepository],
})
export class EventLogsModule {}
