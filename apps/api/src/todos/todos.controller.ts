import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { TodoItemCreateDto, TodoItemPatchDto, TodoListInputDto } from './dto/todo.dto.js';
import { TodosService } from './todos.service.js';

/** (#276) 할 일 목록 (api.md 2.11). 팀 안 경로는 번호, 상세 조회만 공개 코드 (D-203) */
@Controller('groups/:groupId')
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Get('todo-lists')
  listLists(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number) {
    return this.todos.listLists(user.id, groupId);
  }

  @Post('todo-lists')
  createList(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @Body() dto: TodoListInputDto) {
    return this.todos.createList(user.id, groupId, dto);
  }

  @Patch('todo-lists/:listId')
  renameList(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('listId') listId: number, @Body() dto: TodoListInputDto) {
    return this.todos.renameList(user.id, groupId, listId, dto);
  }

  @Delete('todo-lists/:listId')
  deleteList(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('listId') listId: number) {
    return this.todos.deleteList(user.id, groupId, listId);
  }

  @Post('todo-lists/:listId/items')
  createItem(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('listId') listId: number, @Body() dto: TodoItemCreateDto) {
    return this.todos.createItem(user.id, groupId, listId, dto);
  }

  /** 완료 항목 지우기 `?done=true` */
  @Delete('todo-lists/:listId/items')
  @HttpCode(200)
  clearDone(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('listId') listId: number, @Query('done') done: unknown) {
    return this.todos.clearDone(user.id, groupId, listId, done);
  }

  @Patch('todo-items/:itemId')
  updateItem(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('itemId') itemId: number, @Body() dto: TodoItemPatchDto) {
    return this.todos.updateItem(user.id, groupId, itemId, dto);
  }

  @Delete('todo-items/:itemId')
  deleteItem(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('itemId') itemId: number) {
    return this.todos.deleteItem(user.id, groupId, itemId);
  }
}

/** (#276) 공개 코드로 목록 하나 `GET /todo-lists/:code` (api.md 2.11). 멤버가 아니면 404 */
@Controller('todo-lists')
export class TodoLookupController {
  constructor(private readonly todos: TodosService) {}

  @Get(':code')
  getByCode(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.todos.getByCode(user.id, code);
  }
}
