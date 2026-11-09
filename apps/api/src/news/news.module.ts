import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { NewsController } from './news.controller.js';
import { NewsService } from './news.service.js';

@Module({
  imports: [GroupsModule],
  controllers: [NewsController],
  providers: [NewsService],
})
export class NewsModule {}
