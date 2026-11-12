import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AnniversariesModule } from './anniversaries/anniversaries.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ResponseInterceptor } from './common/response.interceptor.js';
import { createValidationPipe } from './common/validation.js';
import { EmailLoginModule } from './email-login/email-login.module.js';
import { EventSharesModule } from './event-shares/event-shares.module.js';
import { EventsModule } from './events/events.module.js';
import { FileUrlModule } from './files/file-url.module.js';
import { FreeSlotsModule } from './free-slots/free-slots.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { HealthController } from './health/health.controller.js';
import { MeModule } from './me/me.module.js';
import { NewsModule } from './news/news.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PushModule } from './push/push.module.js';
import { TodosModule } from './todos/todos.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    FileUrlModule,
    AuthModule,
    EmailLoginModule,
    GroupsModule,
    EventsModule,
    EventSharesModule,
    ImportsModule,
    AnniversariesModule,
    TodosModule,
    FreeSlotsModule,
    NewsModule,
    MeModule,
    PushModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule {}
