import { IsIn } from 'class-validator';

/** (#515) 사용자 역할 값 (Prisma enum UserRole 과 같다, D-285) */
export const USER_ROLES = ['user', 'admin'] as const;

/** (#515) PATCH /admin/users/:id/role */
export class UpdateRoleDto {
  @IsIn(USER_ROLES, { message: 'role 은 user 또는 admin 이어야 해요' })
  role!: (typeof USER_ROLES)[number];
}
