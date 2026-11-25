import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin-access.js';
import type { AuthUser } from '../auth/auth.service.js';
import { CurrentUser, OptionalUser } from '../auth/current-user.decorator.js';
import { OptionalAuth } from '../auth/jwt-auth.guard.js';
import { IdParam } from '../common/id-param.js';
import { parsePageQuery, parseSearchText } from '../common/page-query.js';
import { CreateNoticeDto, ReadNoticeDto, UpdateNoticeDto } from './dto/notice.dto.js';
import { NoticeReadsService, parseReadVia, parseUnreadFlag } from './notice-reads.service.js';
import { NoticesService } from './notices.service.js';

/** (#515) 공지 읽기 (api.md 2.16). 로그인 없이 열리고(선택 인증), 로그인했으면 unread 를 계산한다 */
@Controller('notices')
export class NoticesController {
  constructor(
    private readonly notices: NoticesService,
    private readonly reads: NoticeReadsService,
  ) {}

  @Get()
  @OptionalAuth()
  list(@OptionalUser() user: AuthUser | null, @Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown) {
    return this.notices.listPublished(user?.id ?? null, parsePageQuery({ limit, cursor }));
  }

  /** 목록을 본 시각 기록. 멱등이라 200. ':id' 보다 먼저 등록 */
  @Post('seen')
  @HttpCode(200)
  seen(@CurrentUser() user: AuthUser) {
    return this.notices.markSeen(user.id);
  }

  /** (#538) 팝업과 새 공지 띠 (D-291). 로그인만. ':id' 보다 먼저 등록 */
  @Get('attention')
  attention(@CurrentUser() user: AuthUser) {
    return this.notices.attention(user.id);
  }

  /** (#538) 팝업 닫기. 멱등이라 200 */
  @Post(':id/dismiss')
  @HttpCode(200)
  dismiss(@CurrentUser() user: AuthUser, @IdParam('id') id: number) {
    return this.notices.dismiss(user.id, id);
  }

  /**
   * (#544) 로그인한 사용자가 공지 상세를 열었다 (D-293). 처음 한 번만 남고 경로도 처음 것. 멱등이라 200.
   * GET /notices/:id 는 로그인 없이 같은 응답이 되도록 기록하지 않고 화면이 따로 부른다
   */
  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @IdParam('id') id: number, @Body() dto: ReadNoticeDto) {
    return this.reads.markRead(user.id, id, dto.via ?? 'detail');
  }

  @Get(':id')
  @OptionalAuth()
  get(@OptionalUser() user: AuthUser | null, @IdParam('id') id: number) {
    return this.notices.get(user?.id ?? null, id);
  }
}

/** (#515) 공지 작성 (api.md 2.16). 관리자만, 아니면 403 */
@Controller('admin/notices')
@UseGuards(AdminGuard)
export class AdminNoticesController {
  constructor(
    private readonly notices: NoticesService,
    private readonly reads: NoticeReadsService,
  ) {}

  /** (#544) 줄마다 readCount (읽은 사람 수) */
  @Get()
  async list(@Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown) {
    return this.reads.withReadCounts(await this.notices.listAll(parsePageQuery({ limit, cursor })));
  }

  /** (#544) 푸시 결과와 읽은 사람 수 (D-293) */
  @Get(':id/stats')
  stats(@IdParam('id') id: number) {
    return this.reads.stats(id);
  }

  /** (#544) 읽은 사람, unread=1 이면 푸시 대상 중 안 읽은 사람 (D-293) */
  @Get(':id/readers')
  readers(
    @IdParam('id') id: number,
    @Query('q') q?: unknown,
    @Query('via') via?: unknown,
    @Query('unread') unread?: unknown,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ) {
    return this.reads.readers(id, { q: parseSearchText(q), via: parseReadVia(via), unread: parseUnreadFlag(unread), ...parsePageQuery({ limit, cursor }) });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @IdParam('id') id: number) {
    return this.notices.get(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNoticeDto) {
    return this.notices.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @IdParam('id') id: number, @Body() dto: UpdateNoticeDto) {
    return this.notices.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @IdParam('id') id: number) {
    return this.notices.remove(user.id, id);
  }
}
