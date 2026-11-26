import { Injectable } from '@nestjs/common';
import type { AppPlatform } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** (#539) 기종별 앱 최신, 최소 버전 (D-292) */
export interface AppReleaseRow {
  id: number;
  platform: AppPlatform;
  latestVersion: string | null;
  minVersion: string | null;
  storeUrl: string | null;
  updatedAt: Date;
}

export interface AppReleaseWrite {
  latestVersion?: string | null;
  minVersion?: string | null;
  storeUrl?: string | null;
}

const SELECT = {
  id: true,
  platform: true,
  latestVersion: true,
  minVersion: true,
  storeUrl: true,
  updatedAt: true,
} as const;

@Injectable()
export class AppReleasesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByPlatform(platform: AppPlatform): Promise<AppReleaseRow | null> {
    return this.prisma.appRelease.findUnique({
      where: { platform },
      select: SELECT,
    });
  }

  listAll(): Promise<AppReleaseRow[]> {
    return this.prisma.appRelease.findMany({ select: SELECT });
  }

  /** 기종 행이 없으면 만들고(생략한 값은 null), 있으면 준 값만 고친다 */
  upsert(platform: AppPlatform, data: AppReleaseWrite): Promise<AppReleaseRow> {
    return this.prisma.appRelease.upsert({
      where: { platform },
      create: { platform, ...data },
      update: data,
      select: SELECT,
    });
  }
}
