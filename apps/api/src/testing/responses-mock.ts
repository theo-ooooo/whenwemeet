import { vi } from 'vitest';
import { EventResponsesRepository } from '../event-responses/event-responses.repository.js';
import { mockRepository, type RepositoryMock } from './repository-mock.js';

/** (#190) 응답이 하나도 없는 EventResponsesRepository 목 (일정 서비스 단위 테스트용) */
export function emptyResponses(): RepositoryMock<EventResponsesRepository> {
  const mock = mockRepository(EventResponsesRepository);
  mock.listForEvents.mockResolvedValue({ rsvps: [], reactions: [] });
  mock.listForOccurrence.mockResolvedValue({ rsvps: [], reactions: [] });
  vi.mocked(mock.saveRsvp).mockResolvedValue('SAVED');
  return mock;
}
