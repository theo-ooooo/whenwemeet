import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { TodoLookupController, TodosController } from './todos.controller.js';
import { TodosRepository } from './todos.repository.js';
import { TodosService } from './todos.service.js';

/** (#276) 팀 공유 할 일 목록 */
@Module({
  imports: [GroupsModule],
  controllers: [TodosController, TodoLookupController],
  providers: [TodosService, TodosRepository],
})
export class TodosModule {}
