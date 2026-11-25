import { Injectable } from '@nestjs/common';
import { AdminActionsRepository } from '../admin/admin-actions.repository.js';
import { ApiException } from '../common/errors.js';
import type { AppPlatform } from '../generated/prisma/enums.js';
import { compareVersions } from './app-version.js';
import { type AppReleaseRow, AppReleasesRepository, type AppReleaseWrite } from './app-releases.repository.js';
import type { UpdateAppReleaseDto } from './dto/app-release.dto.js';

export const APP_PLATFORMS: readonly AppPlatform[] = ['ios', 'android'];

/** (#539) 스토어 주소를 정하지 않았을 때 쓰는 기본 (App Store 앱 번호, Play 패키지 day.whenwemeet.app) */
export const DEFAULT_STORE_URLS: Record<AppPlatform, string> = {
  ios: 'https://apps.apple.com/kr/app/id6832865813',
  android: 'https://play.google.com/store/apps/details?id=day.whenwemeet.app',
};

/** (#539) GET /app/version, 관리자 목록 한 줄 (D-292). 버전 null = 그 안내를 하지 않음 */
export interface AppRelease {
  platform: AppPlatform;
  latestVersion: string | null;
  minVersion: string | null;
  storeUrl: string;
  updatedAt: Date | null;
}

const PLATFORM_MESSAGE = 'platform 은 ios, android 중 하나여야 해요';
const MIN_ABOVE_LATEST = '최소 버전은 최신 버전보다 높을 수 없어요';

/** `?platform=`, `:platform` 원문 → 기종. 그 밖이면 400 */
export function parseAppPlatform(raw: unknown): AppPlatform {
  if (raw === 'ios' || raw === 'android') return raw;
  throw new ApiException('VALIDATION_FAILED', PLATFORM_MESSAGE, [{ field: 'platform', message: PLATFORM_MESSAGE }]);
}

function toRelease(platform: AppPlatform, row: AppReleaseRow | null): AppRelease {
  return {
    platform,
    latestVersion: row?.latestVersion ?? null,
    minVersion: row?.minVersion ?? null,
    storeUrl: row?.storeUrl ?? DEFAULT_STORE_URLS[platform],
    updatedAt: row?.updatedAt ?? null,
  };
}

/** 조치 기록 사유: "ios 최신 1.4.0, 최소 1.1.0" (없으면 "없음") */
function describe(row: AppReleaseRow): string {
  return `${row.platform} 최신 ${row.latestVersion ?? '없음'}, 최소 ${row.minVersion ?? '없음'}`.slice(0, 200);
}

/** (#539) 앱 업데이트 안내 (api.md 2.17, D-292). 읽기는 누구나, 고치기는 관리자만 */
@Injectable()
export class AppReleasesService {
  constructor(
    private readonly releases: AppReleasesRepository,
    private readonly actions: AdminActionsRepository,
  ) {}

  /** GET /app/version?platform= */
  async get(platform: AppPlatform): Promise<AppRelease> {
    return toRelease(platform, await this.releases.findByPlatform(platform));
  }

  /** GET /admin/app-releases. ios, android 순으로 둘 다 (행이 없으면 빈 값) */
  async list(): Promise<AppRelease[]> {
    const rows = await this.releases.listAll();
    return APP_PLATFORMS.map((platform) => toRelease(platform, rows.find((row) => row.platform === platform) ?? null));
  }

  /**
   * PUT /admin/app-releases/:platform. 고친 결과에서 최소 버전이 최신 버전보다 높으면 400(field minVersion).
   * 바꾸고 조치 기록 app_release_update 한 줄 (사유에 기종과 두 버전)
   */
  async update(adminId: number, platform: AppPlatform, dto: UpdateAppReleaseDto): Promise<AppRelease> {
    const data: AppReleaseWrite = {};
    if (dto.latestVersion !== undefined) data.latestVersion = dto.latestVersion;
    if (dto.minVersion !== undefined) data.minVersion = dto.minVersion;
    if (dto.storeUrl !== undefined) data.storeUrl = dto.storeUrl;
    const current = await this.releases.findByPlatform(platform);
    const latest = data.latestVersion !== undefined ? data.latestVersion : (current?.latestVersion ?? null);
    const min = data.minVersion !== undefined ? data.minVersion : (current?.minVersion ?? null);
    if (latest !== null && min !== null && compareVersions(min, latest) > 0) {
      throw new ApiException('VALIDATION_FAILED', MIN_ABOVE_LATEST, [{ field: 'minVersion', message: MIN_ABOVE_LATEST }]);
    }
    const row = await this.releases.upsert(platform, data);
    await this.actions.record({ adminId, action: 'app_release_update', targetType: 'app_release', targetId: row.id, reason: describe(row) });
    return toRelease(platform, row);
  }
}
