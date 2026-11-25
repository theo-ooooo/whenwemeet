import { AdminActionsRepository } from '../admin/admin-actions.repository.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { type AppReleaseRow, AppReleasesRepository } from './app-releases.repository.js';
import { AppReleasesService, DEFAULT_STORE_URLS, parseAppPlatform } from './app-releases.service.js';
import { compareVersions, VERSION_PATTERN } from './app-version.js';

describe('앱 버전 비교 (#539, D-292)', () => {
  it('마디를 숫자로 비교한다 (1.10.0 > 1.9.0), 없는 마디는 0', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.9', '1.10.0')).toBe(-1);
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
    expect(compareVersions('2', '1.99.99')).toBe(1);
    expect(compareVersions('1.3.0', '1.3.1')).toBe(-1);
  });

  it('꼬리(-beta, +빌드)는 버리고 숫자가 아닌 마디는 0', () => {
    expect(compareVersions('1.4.0-beta.1', '1.4.0')).toBe(0);
    expect(compareVersions('1.4.0+12', '1.3.9')).toBe(1);
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
    expect(compareVersions(' 1.2.0 ', '1.2')).toBe(0);
  });

  it('관리자 입력 형식: 숫자 1~3마디', () => {
    for (const ok of ['1', '1.4', '1.4.0', '10.20.300']) expect(VERSION_PATTERN.test(ok)).toBe(true);
    for (const bad of ['', '1.', 'v1.0', '1.0.0.0', '1.0.0-beta', '1..0', '12345']) expect(VERSION_PATTERN.test(bad)).toBe(false);
  });

  it('parseAppPlatform: ios, android 만, 그 밖은 400', () => {
    expect(parseAppPlatform('ios')).toBe('ios');
    expect(parseAppPlatform('android')).toBe('android');
    for (const bad of [undefined, '', 'web', 'IOS', ['ios']]) expect(() => parseAppPlatform(bad)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });
});

describe('AppReleasesService (#539)', () => {
  let repo: RepositoryMock<AppReleasesRepository>;
  let actions: RepositoryMock<AdminActionsRepository>;
  let service: AppReleasesService;
  const at = new Date('2026-11-25T00:00:00.000Z');
  const row = (overrides: Partial<AppReleaseRow> = {}): AppReleaseRow => ({ id: 1, platform: 'ios', latestVersion: '1.4.0', minVersion: '1.1.0', storeUrl: null, updatedAt: at, ...overrides });

  beforeEach(() => {
    repo = mockRepository(AppReleasesRepository);
    actions = mockRepository(AdminActionsRepository);
    actions.record.mockResolvedValue(undefined);
    service = new AppReleasesService(repo as never, actions as never);
  });

  it('get: 행이 없으면 버전 null(안내 안 함)과 기본 스토어 주소', async () => {
    repo.findByPlatform.mockResolvedValue(null);
    expect(await service.get('android')).toEqual({ platform: 'android', latestVersion: null, minVersion: null, storeUrl: DEFAULT_STORE_URLS.android, updatedAt: null });
  });

  it('get: 행이 있으면 그 값, 스토어 주소가 있으면 그것', async () => {
    repo.findByPlatform.mockResolvedValue(row({ storeUrl: 'https://apps.apple.com/kr/app/id1' }));
    expect(await service.get('ios')).toEqual({ platform: 'ios', latestVersion: '1.4.0', minVersion: '1.1.0', storeUrl: 'https://apps.apple.com/kr/app/id1', updatedAt: at });
  });

  it('list: ios, android 순으로 둘 다 (없는 기종은 빈 값)', async () => {
    repo.listAll.mockResolvedValue([row({ id: 2, platform: 'android', latestVersion: '1.3.0', minVersion: null })]);
    const items = await service.list();
    expect(items.map((item) => [item.platform, item.latestVersion])).toEqual([
      ['ios', null],
      ['android', '1.3.0'],
    ]);
    expect(items[0].storeUrl).toBe(DEFAULT_STORE_URLS.ios);
  });

  it('update: 준 값만 고치고 app_release_update 기록(사유에 기종과 두 버전)', async () => {
    repo.findByPlatform.mockResolvedValue(row());
    repo.upsert.mockResolvedValue(row({ latestVersion: '1.5.0' }));
    const out = await service.update(9, 'ios', { latestVersion: '1.5.0' });
    expect(repo.upsert).toHaveBeenCalledWith('ios', { latestVersion: '1.5.0' });
    expect(out.latestVersion).toBe('1.5.0');
    expect(actions.record).toHaveBeenCalledWith({ adminId: 9, action: 'app_release_update', targetType: 'app_release', targetId: 1, reason: 'ios 최신 1.5.0, 최소 1.1.0' });
  });

  it('update: null 은 지움, 처음이면 행을 만든다(사유 "없음")', async () => {
    repo.findByPlatform.mockResolvedValue(null);
    repo.upsert.mockResolvedValue(row({ id: 3, platform: 'android', latestVersion: null, minVersion: null, storeUrl: null }));
    await service.update(9, 'android', { latestVersion: null, minVersion: null, storeUrl: null });
    expect(repo.upsert).toHaveBeenCalledWith('android', { latestVersion: null, minVersion: null, storeUrl: null });
    expect(actions.record).toHaveBeenCalledWith(expect.objectContaining({ targetId: 3, reason: 'android 최신 없음, 최소 없음' }));
  });

  it('update: 고친 결과의 최소 버전이 최신보다 높으면 400 (저장, 기록 없음). 같으면 된다', async () => {
    repo.findByPlatform.mockResolvedValue(row());
    await expect(service.update(9, 'ios', { minVersion: '1.10.0' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'minVersion' }] });
    await expect(service.update(9, 'ios', { latestVersion: '1.0.9' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(actions.record).not.toHaveBeenCalled();

    repo.upsert.mockResolvedValue(row({ minVersion: '1.4.0' }));
    await service.update(9, 'ios', { minVersion: '1.4.0' });
    expect(repo.upsert).toHaveBeenCalledWith('ios', { minVersion: '1.4.0' });
  });

  it('update: 최신을 지우면 최소만 남아도 된다', async () => {
    repo.findByPlatform.mockResolvedValue(row());
    repo.upsert.mockResolvedValue(row({ latestVersion: null }));
    await service.update(9, 'ios', { latestVersion: null, minVersion: '2.0.0' });
    expect(repo.upsert).toHaveBeenCalledWith('ios', { latestVersion: null, minVersion: '2.0.0' });
  });
});
