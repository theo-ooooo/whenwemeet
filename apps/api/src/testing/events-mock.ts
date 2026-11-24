import { EventReadsRepository } from '../events/event-reads.repository.js';
import { EventRemovalsRepository } from '../events/event-removals.repository.js';
import { EventSearchRepository } from '../events/event-search.repository.js';
import { EventSeriesRepository } from '../events/event-series.repository.js';
import { EventSeriesService } from '../events/event-series.service.js';
import { EventWritesRepository } from '../events/event-writes.repository.js';
import { EventsService } from '../events/events.service.js';
import type { MembershipService } from '../groups/membership.service.js';
import { mockRepository, type RepositoryMock } from './repository-mock.js';

/** (#504) EventsService 가 받는 일정 저장소 다섯 개를 하나로 합친 목 */
export type EventsRepositoryMock = RepositoryMock<EventReadsRepository> &
  RepositoryMock<EventSearchRepository> &
  RepositoryMock<EventWritesRepository> &
  RepositoryMock<EventRemovalsRepository> &
  RepositoryMock<EventSeriesRepository>;

export function mockEventsRepositories(): EventsRepositoryMock {
  return {
    ...mockRepository(EventReadsRepository),
    ...mockRepository(EventSearchRepository),
    ...mockRepository(EventWritesRepository),
    ...mockRepository(EventRemovalsRepository),
    ...mockRepository(EventSeriesRepository),
  };
}

/** (#504) 합친 목을 각 저장소 자리에 넘겨 EventsService (EventSeriesService 포함) 를 만든다 */
export function eventsServiceWith(events: object, memberships: MembershipService, responses: object): EventsService {
  const repo = events as never;
  return new EventsService(repo, repo, repo, repo, repo, memberships, responses as never, new EventSeriesService(repo, repo, memberships));
}
