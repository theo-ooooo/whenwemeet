import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { KakaoClient } from './kakao.client.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '30d') as JwtSignOptions['expiresIn'],
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, KakaoClient, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [AuthService, KakaoClient, JwtModule],
})
export class AuthModule {}
