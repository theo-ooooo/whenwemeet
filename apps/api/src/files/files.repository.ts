import { Injectable } from '@nestjs/common';
import type { FileKind, StorageProvider } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 저장소에서 객체를 지우는 데 필요한 것 */
export interface StoredObjectRef {
  id: number;
  provider: StorageProvider;
  bucket: string;
  key: string;
}

/** 새 File 행 (결정기록 D-38). 공개 URL(도메인) 은 저장하지 않는다 — 읽을 때 FileUrlBuilder 가 만든다 (D-56) */
export interface NewFileInput {
  provider: StorageProvider;
  bucket: string;
  key: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  kind: FileKind;
  sourceUrl: string | null;
}

const OBJECT_REF_SELECT = {
  id: true,
  provider: true,
  bucket: true,
  key: true,
} as const;

@Injectable()
export class FilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 소유자의 파일 전부 (탈퇴 시 객체 정리용), id 오름차순 */
  listByOwner(ownerId: number): Promise<StoredObjectRef[]> {
    return this.prisma.file.findMany({
      where: { ownerId },
      orderBy: { id: 'asc' },
      select: OBJECT_REF_SELECT,
    });
  }

  /**
   * 프로필 사진 교체를 한 트랜잭션으로: 새 File 생성 → User.avatarFileId 교체 → 이전 File 행 삭제.
   * 이전 파일의 객체는 Service 가 커밋 뒤에 지우도록 돌려준다
   */
  replaceAvatarTx(
    userId: number,
    input: NewFileInput,
  ): Promise<{ previous: StoredObjectRef | null }> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatar: { select: OBJECT_REF_SELECT } },
      });
      const file = await tx.file.create({
        data: { ...input, ownerId: userId },
        select: { id: true },
      });
      await tx.user.update({
        where: { id: userId },
        data: { avatarFileId: file.id },
      });
      if (user.avatar) await tx.file.delete({ where: { id: user.avatar.id } });
      return { previous: user.avatar };
    });
  }

  /** 프로필 사진을 기본(없음) 으로: avatarFileId 를 비우고 File 행 삭제. 지운 파일(없으면 null) 을 돌려준다 */
  clearAvatarTx(userId: number): Promise<StoredObjectRef | null> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatar: { select: OBJECT_REF_SELECT } },
      });
      if (!user.avatar) return null;
      await tx.user.update({
        where: { id: userId },
        data: { avatarFileId: null },
      });
      await tx.file.delete({ where: { id: user.avatar.id } });
      return user.avatar;
    });
  }
}
