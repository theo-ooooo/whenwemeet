import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdParam } from '../common/id-param.js';
import { PollConfirmDto, PollInputDto, PollListQueryDto, PollVotesDto } from './dto/poll.dto.js';
import { PollsService } from './polls.service.js';

/** (#189) 약속 투표 (api.md 2.13). 팀 안 경로는 번호, 하나 조회만 공개 코드 (할 일 목록 D-206 과 같은 방식) */
@Controller('groups/:groupId/polls')
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @Query() query: PollListQueryDto) {
    return this.polls.list(user.id, groupId, query.status ?? 'open');
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @Body() dto: PollInputDto) {
    return this.polls.create(user.id, groupId, dto);
  }

  @Put(':pollId/votes')
  vote(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('pollId') pollId: number, @Body() dto: PollVotesDto) {
    return this.polls.vote(user.id, groupId, pollId, dto);
  }

  @Post(':pollId/confirm')
  confirm(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('pollId') pollId: number, @Body() dto: PollConfirmDto) {
    return this.polls.confirm(user.id, groupId, pollId, dto);
  }

  @Delete(':pollId')
  remove(@CurrentUser() user: AuthUser, @IdParam('groupId') groupId: number, @IdParam('pollId') pollId: number) {
    return this.polls.remove(user.id, groupId, pollId);
  }
}

/** (#189) 공개 코드로 투표 하나 `GET /polls/:code`. 멤버가 아니면 404 */
@Controller('polls')
export class PollLookupController {
  constructor(private readonly polls: PollsService) {}

  @Get(':code')
  getByCode(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.polls.getByCode(user.id, code);
  }
}
