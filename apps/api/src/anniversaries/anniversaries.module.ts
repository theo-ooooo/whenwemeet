import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { AnniversariesController } from './anniversaries.controller.js';
import { AnniversariesService } from './anniversaries.service.js';

@Module({
  imports: [GroupsModule],
  controllers: [AnniversariesController],
  providers: [AnniversariesService],
})
export class AnniversariesModule {}
