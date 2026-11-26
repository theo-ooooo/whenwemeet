import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnniversariesModule } from '../anniversaries/anniversaries.module.js';
import { EventsModule } from '../events/events.module.js';
import { FreeSlotsModule } from '../free-slots/free-slots.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  ASSISTANT_MODEL,
  type AssistantModel,
  assistantModelChoice,
  UnavailableAssistantModel,
} from './assistant-model.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { FakeAssistantModel } from './fake-model.js';
import { OpenAiAssistantModel } from './openai-model.js';
import { AssistantUsageRepository } from './usage.repository.js';

/** 키가 있으면 OpenAI, `ASSISTANT_FAKE=1`(운영 제외)이면 가짜, 아니면 미설정 (D-271). 키 값은 로그에 남기지 않는다 */
export function createAssistantModel(config: ConfigService): AssistantModel {
  const choice = assistantModelChoice(config);
  let model: AssistantModel;
  if (choice.kind === 'openai' && choice.apiKey)
    model = OpenAiAssistantModel.create(choice.apiKey, choice.model);
  else if (choice.kind === 'fake') model = new FakeAssistantModel();
  else model = new UnavailableAssistantModel();
  new Logger('Assistant').log(
    `AI 비서 모델: ${model.kind}${model.kind === 'openai' ? ` (${choice.model})` : ''}`,
  );
  return model;
}

/** (#450) AI 비서 볼까 (설계 AI-비서.md). 모델은 ASSISTANT_MODEL 로 주입 (테스트는 목) */
@Module({
  imports: [
    GroupsModule,
    UsersModule,
    EventsModule,
    FreeSlotsModule,
    AnniversariesModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantUsageRepository,
    {
      provide: ASSISTANT_MODEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createAssistantModel(config),
    },
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
