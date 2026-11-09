import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** 트랜잭션 안팎 어디서나 같은 코드를 쓰기 위한 클라이언트 타입 (Repository 전용) */
export type Db = Prisma.TransactionClient;

/** Prisma 7 은 드라이버 어댑터가 필수 (결정기록 D-01). MySQL 은 @prisma/adapter-mariadb */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({ adapter: new PrismaMariaDb(config.getOrThrow<string>('DATABASE_URL')) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
