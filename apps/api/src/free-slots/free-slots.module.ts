import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { FreeSlotsController } from './free-slots.controller.js';
import { FreeSlotsService } from './free-slots.service.js';

@Module({
  imports: [GroupsModule],
  controllers: [FreeSlotsController],
  providers: [FreeSlotsService],
})
export class FreeSlotsModule {}
