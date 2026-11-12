import { mockRepository, type RepositoryMock } from '../testing/repository-mock.js';
import { PushDevicesService } from './push-devices.service.js';
import { PushRepository } from './push.repository.js';

describe('PushDevicesService (설계 7-1)', () => {
  let push: RepositoryMock<PushRepository>;
  let service: PushDevicesService;
  const settings = { reminder: true, change: true, anniversary: true, join: true, weekly: true, weeklyNudge: false };

  beforeEach(() => {
    push = mockRepository(PushRepository);
    service = new PushDevicesService(push as never);
    push.registerDevice.mockResolvedValue(undefined);
    push.removeDevice.mockResolvedValue(undefined);
    push.getSettings.mockResolvedValue(settings);
    push.updateSettings.mockImplementation(async (_userId, patch) => ({ ...settings, ...patch }));
  });

  it('register: 지금 시각으로 upsert', async () => {
    const now = new Date('2026-11-12T00:00:00Z');
    const input = { token: 'ExponentPushToken[a]', platform: 'IOS' as const, appVersion: '1.1.0' };
    expect(await service.register(1, input, now)).toEqual({ ok: true });
    expect(push.registerDevice).toHaveBeenCalledWith(1, input, now);
  });

  it('remove: 내 행만 (멱등)', async () => {
    expect(await service.remove(1, 'ExponentPushToken[a]')).toEqual({ ok: true });
    expect(push.removeDevice).toHaveBeenCalledWith(1, 'ExponentPushToken[a]');
  });

  it('settings: 사용자가 없으면 401', async () => {
    expect(await service.settings(1)).toEqual(settings);
    push.getSettings.mockResolvedValueOnce(null);
    await expect(service.settings(1)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('updateSettings: 준 값만 저장, 빈 본문은 그대로 읽기만', async () => {
    expect(await service.updateSettings(1, { change: false, join: undefined })).toEqual({ ...settings, change: false });
    expect(push.updateSettings).toHaveBeenCalledWith(1, { change: false });
    await service.updateSettings(1, {});
    expect(push.updateSettings).toHaveBeenCalledTimes(1);
    expect(push.getSettings).toHaveBeenCalledTimes(1);
  });
});
