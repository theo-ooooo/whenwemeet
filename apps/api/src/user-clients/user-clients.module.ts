import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { UserClientsInterceptor } from './user-clients.interceptor.js';
import { UserClientsRepository } from './user-clients.repository.js';
import {
  UserClientsClock,
  UserClientsService,
} from './user-clients.service.js';

/** (#532) 접속 기종 기록 (D-288). 전역 인터셉터 하나 */
@Module({
  providers: [
    UserClientsRepository,
    UserClientsClock,
    UserClientsService,
    { provide: APP_INTERCEPTOR, useClass: UserClientsInterceptor },
  ],
})
export class UserClientsModule {}
