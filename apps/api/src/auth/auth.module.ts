import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthHandoffsModule } from '../auth-handoffs/auth-handoffs.module.js';
import { AvatarsModule } from '../avatars/avatars.module.js';
import { UsersModule } from '../users/users.module.js';
import { AppAuthService } from './app-auth.service.js';
import { AppleAuthService } from './apple-auth.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RateLimitGuard, RateLimitSettings } from '../rate-limit/rate-limit.guard.js';
import { RateLimitStore } from '../rate-limit/rate-limit.store.js';
import { APPLE_JWKS, AppleProvider, createAppleJwks } from './providers/apple.provider.js';
import { AuthProviders } from './providers/auth-providers.js';
import { DevProvider } from './providers/dev.provider.js';
import { EmailProvider } from './providers/email.provider.js';
import { KakaoProvider } from './providers/kakao.provider.js';

@Module({
  imports: [
    UsersModule,
    AvatarsModule,
    AuthHandoffsModule,
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
  providers: [
    AuthService,
    AppAuthService,
    AppleAuthService,
    KakaoProvider,
    DevProvider,
    AppleProvider,
    EmailProvider,
    { provide: APPLE_JWKS, useFactory: createAppleJwks },
    AuthProviders,
    // (#186) 전역 가드는 등록 순서대로 돈다. 요청 제한이 인증보다 먼저여야 401 이 될 요청도 IP 한도에 들어간다
    RateLimitStore,
    RateLimitSettings,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, AuthProviders, JwtModule],
})
export class AuthModule {}
