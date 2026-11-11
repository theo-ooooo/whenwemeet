import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors.js';
import type { ParticipantSet } from '../events/participants.js';
import { snapshotName } from '../group-activities/activity.js';
import { MembershipService } from '../groups/membership.service.js';
import { importPayload } from '../push/push-copy.js';
import type { ImportOptionsDto } from './dto/import.dto.js';
import { ICS_READ_FAILED_MESSAGE, parseIcs } from './ics-parse.js';
import { buildCandidates, finalizePlan, type ImportPlan, type ImportPreview, type PlannedEvent, type SkipReason } from './import-plan.js';
import { ImportsRepository, isDuplicateItemError } from './imports.repository.js';

/** 한 트랜잭션에 넣는 일정 수 (기획 3장) */
export const IMPORT_BATCH_SIZE = 200;

/** 업로드된 파일 (multer 메모리) */
export interface UploadedIcs {
  buffer: Buffer;
  size: number;
}

export interface ImportResult {
  /** 넣은 게 없으면 null (가져오기 행을 만들지 않는다) */
  importId: number | null;
  created: number;
  skipped: { reason: SkipReason; count: number }[];
}

const noFile = () => new ApiException('VALIDATION_FAILED', ICS_READ_FAILED_MESSAGE, [{ field: 'file', message: ICS_READ_FAILED_MESSAGE }]);

/**
 * (#279) ICS 파일 가져오기 (api.md 2.9, 설계 `일정-가져오기.md`). 파일은 메모리에서 읽고 버린다.
 * 미리보기는 아무것도 저장하지 않고, 넣기는 같은 계산을 다시 해서(서버 상태 없음) 200개씩 커밋한다
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger('Import');

  constructor(
    private readonly imports: ImportsRepository,
    private readonly memberships: MembershipService,
  ) {}

  async preview(userId: number, groupId: number, file: UploadedIcs | undefined, options: ImportOptionsDto, now: Date = new Date()): Promise<ImportPreview> {
    await this.memberships.assertMember(userId, groupId);
    return (await this.plan(groupId, file, options, now)).preview;
  }

  async import(userId: number, groupId: number, file: UploadedIcs | undefined, options: ImportOptionsDto, now: Date = new Date()): Promise<ImportResult> {
    const me = await this.memberships.assertMember(userId, groupId);
    const group = await this.imports.findGroup(groupId);
    if (!group) throw new ApiException('FORBIDDEN');
    const plan = await this.plan(groupId, file, options, now);
    const skipped = new Map(plan.preview.skipped.map((skip) => [skip.reason, skip.count]));
    if (plan.events.length === 0) return { importId: null, created: 0, skipped: toSkipList(skipped) };

    // (기획 Q4) 팀은 "모두" 가 기본, 개인 달력은 나. [나만] 을 고르면 나
    const participantsMode = options.participants ?? (group.type === 'TEAM' ? 'ALL' : 'ME');
    const participants: ParticipantSet = participantsMode === 'ALL' ? { allMembers: true, ids: [] } : { allMembers: false, ids: [userId] };
    const actor = { id: userId, name: snapshotName(me.displayName, me.user.nickname) };
    const importId = await this.imports.startImport(groupId, userId);

    let created = 0;
    let pending = plan.events;
    try {
      while (pending.length > 0) {
        const batch = pending.slice(0, IMPORT_BATCH_SIZE);
        pending = pending.slice(IMPORT_BATCH_SIZE);
        created += await this.insertBatch(importId, groupId, userId, participants, batch, skipped);
      }
    } catch (error) {
      this.logger.error(`import.failed group=${groupId} import=${importId} created=${created}/${plan.events.length}`, error instanceof Error ? error.stack : undefined);
      // 넣은 만큼은 남는다. 알림도 그만큼만 (실패를 알리는 것보다 다시 올리면 나머지가 들어간다는 게 중요하다)
      await this.finish(importId, groupId, actor, created, group, now, false).catch(() => undefined);
      throw new ApiException(
        'IMPORT_INCOMPLETE',
        `${plan.events.length.toLocaleString('en-US')}개 중 ${created.toLocaleString('en-US')}개 넣었어요. 같은 파일을 다시 올리면 나머지만 들어가요`,
        { created, total: plan.events.length },
      );
    }
    await this.finish(importId, groupId, actor, created, group, now, true);
    return { importId, created, skipped: toSkipList(skipped) };
  }

  /** 파일 → 계획. 파일이 없으면 VALIDATION_FAILED(file) */
  private async plan(groupId: number, file: UploadedIcs | undefined, options: ImportOptionsDto, now: Date): Promise<ImportPlan> {
    if (!file?.buffer) throw noFile();
    const candidates = buildCandidates(parseIcs(file.buffer), options.range ?? 'future', now);
    const existing = await this.imports.findImportedHashes(groupId, candidates.events.map((event) => event.uidHash));
    return finalizePlan(candidates, existing);
  }

  /** 한 묶음. 동시에 같은 파일을 넣어 유일 제약에 걸리면 이미 들어간 것을 빼고 한 번 더 */
  private async insertBatch(
    importId: number,
    groupId: number,
    userId: number,
    participants: ParticipantSet,
    batch: PlannedEvent[],
    skipped: Map<SkipReason, number>,
  ): Promise<number> {
    try {
      return await this.imports.insertBatchTx(importId, groupId, userId, participants, batch);
    } catch (error) {
      if (!isDuplicateItemError(error)) throw error;
      const existing = await this.imports.findImportedHashes(groupId, batch.map((event) => event.uidHash));
      const rest = batch.filter((event) => !existing.has(event.uidHash));
      skipped.set('DUPLICATE', (skipped.get('DUPLICATE') ?? 0) + batch.length - rest.length);
      return this.imports.insertBatchTx(importId, groupId, userId, participants, rest);
    }
  }

  private finish(
    importId: number,
    groupId: number,
    actor: { id: number; name: string },
    count: number,
    group: { type: 'PERSONAL' | 'TEAM'; name: string },
    now: Date,
    done: boolean,
  ): Promise<void> {
    const push = group.type === 'TEAM' && count > 0 ? importPayload(groupId, group.name, actor.name, count, now) : null;
    return this.imports.finishTx({ importId, groupId, actor, count, push, done });
  }
}

const SKIP_ORDER: readonly SkipReason[] = ['DUPLICATE', 'CANCELLED', 'TOO_OLD', 'TOO_LONG', 'INVALID', 'OVER_LIMIT'];

function toSkipList(skipped: Map<SkipReason, number>): { reason: SkipReason; count: number }[] {
  return SKIP_ORDER.filter((reason) => (skipped.get(reason) ?? 0) > 0).map((reason) => ({ reason, count: skipped.get(reason)! }));
}
