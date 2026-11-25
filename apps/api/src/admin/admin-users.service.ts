import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import type { PageQuery } from '../common/page-query.js';
import type { UserRole } from '../generated/prisma/enums.js';
import { type AdminUserRow, UsersRepository } from '../users/users.repository.js';
import { AdminActionsRepository } from './admin-actions.repository.js';

/** (#515) 관리자 화면의 사용자 목록과 역할 바꾸기 (D-285). 관리자 확인은 컨트롤러의 AdminGuard */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly actions: AdminActionsRepository,
  ) {}

  /** GET /admin/users. 최근 가입 먼저, q 는 닉네임 부분 일치 */
  list(query: PageQuery & { q: string | null }): Promise<{ items: AdminUserRow[]; nextCursor: number | null }> {
    return this.users.listForAdmin(query);
  }

  /**
   * PATCH /admin/users/:id/role. 내 역할은 바꿀 수 없다(403, 마지막 관리자가 스스로 빠지는 일을 막는다).
   * 없는 사용자는 404. 바뀐 뒤 조치 기록 user_role (reason 에 새 역할)
   */
  async changeRole(actorId: number, targetId: number, role: UserRole): Promise<AdminUserRow> {
    if (actorId === targetId) throw new ApiException('FORBIDDEN', '내 역할은 바꿀 수 없어요');
    const row = await this.users.updateRole(targetId, role);
    if (!row) throw new ApiException('NOT_FOUND', '사용자를 찾을 수 없어요');
    await this.actions.record({ adminId: actorId, action: 'user_role', targetType: 'user', targetId: targetId, reason: role });
    return row;
  }
}
